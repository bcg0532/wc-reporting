const csv = require('csvtojson');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const _ = require('lodash');
const WCApiRequest = require("../utils/Woocommerce");

const fetchOrders = async (product) => {
  let page = 1;
  const per_page = 100;
  let orders = [];
  let fetched = [];

  const filePath = path.join(__dirname, '..', 'public', 'settings.json');
  const data = JSON.parse(fs.readFileSync(filePath));

  do {
    const params = {
      per_page,
      page,
      product,
      order: 'asc'
    };

    if (data.start) {
      params.after = `${data.start}T00:00:00Z`;
    }

    if (data.end) {
      params.before = `${data.start}T23:59:59Z`;
    }

    const res = await WCApiRequest({
      url: '/orders',
      method: 'get',
      params
    });

    fetched = res.data;
    orders = [...orders, ...fetched];
    page++;
  } while (fetched.length === per_page);

  return orders;
}

exports.fetchReportingByProduct = async (productId) => {
  const { data: product } = await WCApiRequest({
    url: `/products/${productId}`,
    method: 'get'
  });
  if (product.type === 'simple') {
    // one-time payment
    const data = await fetchOrders(productId);
    console.log('Fetched orders', data.length);
  
    const grossRevenue = data
      .filter(item => ['completed', 'processing', 'on-hold'].includes(item.status))
      .map(o => parseFloat(o.total))
      .reduce((a, b) => a + b, 0).toFixed(2);
      
    const totalRefunds = data.filter(o => o.refunds.length > 0).reduce((a, b) => a + b.refunds.reduce((t, v) => t + parseFloat(v.total), 0), 0).toFixed(2);
    
    const totalFee = data
      .map(o => o.meta_data.find(meta => meta.key === '_fkwcs_stripe_fee')?.value)
      .filter(v => !!v)
      .reduce((a, b) => a + parseFloat(b), 0).toFixed(2);
  
    const netRevenue = data
      .filter(item => ['completed', 'processing'].includes(item.status))
      .map(o => parseFloat(o.total) + o.refunds.reduce((a, b) => a + parseFloat(b.total), 0))
      .reduce((a, b) => a + b, 0).toFixed(2);

    const enrollments = _.uniq(data.map(o => o.customer_id || o.billing.email).filter(id => !!id));

    return {
      gross_revenue: grossRevenue,
      expected_revenue: netRevenue,
      net_revenue: netRevenue,
      total_refunds: totalRefunds * -1,
      total_stripe_fee: totalFee,
      enrollments: enrollments
    };
  } else if (product.type === 'subscription') {
    // subscription
    const price = product.price;
    const length = product.meta_data.find(meta => meta.key === '_subscription_length')?.value;
    const planPrice = price * length;
    const data = await fetchOrders(productId);
    console.log('Fetched orders', data.length);
    const subscriptions = {};
    const parentOrders = [];

    let grossRevenue = 0;
    let expectedRevenue = 0;
    let totalRefunds = 0;
    let totalFee = 0;
    let netRevenue = 0;
    let enrollments = [];

    for (const order of data) {
      const renewal = order.meta_data.find(meta => meta.key === '_subscription_renewal');
      if (renewal) {
        if (!subscriptions[renewal.value]) {
          subscriptions[renewal.value] = [];
        }

        subscriptions[renewal.value].push(order);
      } else {
        parentOrders.push(order);
      }
    }

    for (const orderId in subscriptions) {
      const subscriptionOrders = subscriptions[orderId];
      enrollments.push(subscriptionOrders[0].customer_id || subscriptionOrders[0].billing.email);

      const lastSubscription = subscriptionOrders[subscriptionOrders.length - 1];
      let parentSubscription;
      let maxLength = length;

      try {
        const resp = await WCApiRequest({
          url: `/orders/${orderId}`,
          method: 'get'
        });
        parentSubscription = resp.data;
        const parentId = parentSubscription.parent_id;
        const idx = parentOrders.findIndex(order => order.id === parentId);
        if (idx > -1) {
          subscriptionOrders.push(parentOrders[idx]);
          parentOrders.splice(idx, 1);
        } else {
          const childIds = parentSubscription.meta_data.find(meta => meta.key === '_subscription_renewal_order_ids_cache').value;
          const allIds = _.uniq([...childIds, parentId]);
          const missingCount = allIds.length - subscriptionOrders.length;
          maxLength = length - missingCount;
        }
      } catch (e) {
        console.log(`Fetching error for parent subscription ${orderId}`, subscriptionOrders.map(o => o.id));
      }

      if (['completed', 'processing', 'on-hold'].includes(lastSubscription.status)) {
        expectedRevenue += price * maxLength + subscriptionOrders.reduce((t, o) => t + o.refunds.reduce((a, b) => a + parseFloat(b.total), 0), 0);
      } else {
        expectedRevenue += subscriptionOrders
          .filter(o => ['completed', 'processing', 'on-hold'].includes(o.status))
          .reduce((t, o) => t + parseFloat(o.total) + o.refunds.reduce((a, b) => a + parseFloat(b.total), 0), 0);
      }

      netRevenue += subscriptionOrders
        .filter(o => ['completed', 'processing'].includes(o.status))
        .reduce((t, o) => t + parseFloat(o.total) + o.refunds.reduce((a, b) => a + parseFloat(b.total), 0), 0);

      totalRefunds += subscriptionOrders.reduce((t, o) => t + o.refunds.reduce((a, b) => a + parseFloat(b.total), 0), 0);
      totalFee += subscriptionOrders
        .map(o => o.meta_data.find(meta => meta.key === '_fkwcs_stripe_fee')?.value)
        .filter(v => !!v)
        .reduce((a, b) => a + parseFloat(b), 0);

      grossRevenue += price * maxLength;
    }

    for (const order of parentOrders) {
      grossRevenue += planPrice;
      if (['completed', 'processing', 'on-hold'].includes(order.status)) {
        expectedRevenue += planPrice + order.refunds.reduce((a, b) => a + parseFloat(b.total), 0);
      }

      if (['completed', 'processing'].includes(order.status)) {
        netRevenue += parseFloat(order.total) + order.refunds.reduce((a, b) => a + parseFloat(b.total), 0);
      }

      if (order.refunds) {
        totalRefunds += order.refunds.reduce((a, b) => a + parseFloat(b.total), 0);
      }

      if (order.meta_data.some(meta => meta.key === '_fkwcs_stripe_fee')) {
        totalFee += parseFloat(order.meta_data.find(meta => meta.key === '_fkwcs_stripe_fee').value);
      }

      enrollments.push(order.customer_id || order.billing.email);
    }

    return {
      gross_revenue: grossRevenue.toFixed(2),
      expected_revenue: expectedRevenue.toFixed(2),
      net_revenue: netRevenue.toFixed(2),
      total_refunds: totalRefunds * -1,
      total_stripe_fee: totalFee.toFixed(2),
      enrollments: _.uniq(enrollments.filter(id => !!id))
    };
  }
}

exports.getReporting = async () => {
  const csvFilePath = path.join(__dirname, '..', 'public', 'skus.csv');
  const productList = await csv().fromFile(csvFilePath);

  const jsonData = [];
  let enrollments = [];

  const settingsFilePath = path.join(__dirname, '..', 'public', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFilePath));
  const newSettings = {
    ...settings,
    status: 'processing'
  };
  fs.writeFileSync(settingsFilePath, JSON.stringify(newSettings));

  for (const product of productList) {
    console.log('Product', product['Product ID']);
    const reporting = await this.fetchReportingByProduct(product['Product ID']);
    const productData = {
      Title: product['Title'],
      'Product ID': product['Product ID'],
      Type: product['Type'],
      Sku: product['Sku'],
      'Gross Revenue': reporting.gross_revenue,
      'Expected Revenue': reporting.expected_revenue,
      'Net Revenue': reporting.net_revenue,
      Profit: (reporting.net_revenue - reporting.total_stripe_fee).toFixed(2),
      'Total Refunds': reporting.total_refunds,
      'Total Stripe Fee': reporting.total_stripe_fee,
      Enrollments: reporting.enrollments.length
    };

    enrollments = [...enrollments, ...reporting.enrollments];

    jsonData.push(productData);
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'products', `${product['Product ID']}.json`), JSON.stringify(productData));
  }

  const totalEnrollments = _.uniq(enrollments);
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'enrollments.json'), JSON.stringify(totalEnrollments));
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'reporting.json'), JSON.stringify(jsonData));

  const fields = ['Title', 'Product ID', 'Type', 'Sku', 'Gross Revenue', 'Expected Revenue', 'Net Revenue', 'Profit', 'Total Refunds', 'Total Stripe Fee', 'Enrollments'];

  const json2csvParser = new Parser({ fields });

  try {
    const csv = json2csvParser.parse(jsonData);
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'reporting.csv'), csv);
    console.log('Successfully saved CSV file');
  } catch (err) {
    console.error('Error converting JSON to CSV:', err);
  }

  delete newSettings.status;
  fs.writeFileSync(settingsFilePath, JSON.stringify({
    ...newSettings,
    created: new Date().toISOString()
  }));
}

exports.getReportingByProduct = async (req, res) => {
  const productId = req.params.id;
  const filePath = path.join(__dirname, '..', 'public', 'products', `${productId}.json`);

  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath));
    res.json(data);
  } else {
    const data = await this.fetchReportingByProduct(req.params.id);
    res.json({
      ...data,
      enrollments: data.enrollments.length
    });
  }
}

exports.getEnrollments = (_, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'enrollments.json');
  const data = JSON.parse(fs.readFileSync(filePath));
  res.json(data);
}

exports.getSettings = (_, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'settings.json');
  const data = JSON.parse(fs.readFileSync(filePath));
  res.json(data);
}

exports.updateSettings = (req, res) => {
  const data = req.body;
  const newSetting = {
    ...data,
    status: 'processing'
  };

  fs.writeFileSync(path.join(__dirname, '..', 'public', 'settings.json'), JSON.stringify(newSetting));

  this.getReporting();

  res.json(newSetting);
}

exports.downloadReportingFile = (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'reporting.csv');
  const csvData = fs.readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="reporting.csv"'
  });
  res.end(csvData, 'binary');
}
