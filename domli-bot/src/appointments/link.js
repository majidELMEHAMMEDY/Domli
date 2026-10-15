// Simplest adapter: send the client's booking page. Works with any booking system.
export function createLinkAdapter({ bookingUrl }) {
  return {
    name: 'link',
    async reply() {
      return `U kunt zelf eenvoudig een afspraak inplannen via: ${bookingUrl}`;
    },
  };
}
