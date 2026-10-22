// Simplest adapter: send the client's booking page. Works with any booking system.
export function createLinkAdapter({ bookingUrl }) {
  return {
    name: 'link',
    async reply({ language = 'nl' } = {}) {
      return language === 'en' ? `You can easily book an appointment yourself here: ${bookingUrl}` : `U kunt zelf eenvoudig een afspraak inplannen via: ${bookingUrl}`;
    },
  };
}
