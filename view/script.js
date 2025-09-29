document.addEventListener('alpine:init', () => {
  Alpine.data('main', () => ({
    enrollments: [],
    settings: {},
    products: [],
    reporting: null,

    async loadProducts() {
      this.products = await fetch('/api/product').then(res => res.json());
    },

    async loadEnrollments() {
      this.enrollments = await fetch('/api/reporting/enrollments').then(res => res.json());
    },

    async loadSettings() {
      this.settings = await fetch('/api/reporting/settings').then(res => res.json());
    },

    init() {
      this.loadProducts();
      this.loadEnrollments();
      this.loadSettings();

      this.$watch('settings.status', (val, oldVal) => {
        if (val !== oldVal) {
          this.watchReportingStatus();
        }
      });
    },

    watchReportingStatus() {
      if (this.settings.status === 'processing') {
        console.log('watching reporting status...');
        const interval = setInterval(async () => {
          await this.loadSettings();
          if (!this.settings.status) {
            clearInterval(interval);
  
            Toastify({
              text: "Success! A new reporting is created.",
              duration: 3000,
              gravity: "bottom",
              position: "right",
            }).showToast();
          }
        }, 1000 * 60);
      }
    },

    async createReporting(e) {
      if (this.settings.status === 'processing') return;

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData.entries());

      this.settings = await fetch('/api/reporting/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      }).then(res => res.json());

      Toastify({
        text: "Reporting generation started",
        duration: 3000,
        gravity: "bottom",
        position: "right",
      }).showToast();
    },

    async showReporting(productId) {
      if (this.settings.status === 'processing') return;
      this.reporting = await fetch(`/api/reporting/${productId}`).then(res => res.json());
    }
  }));
});
