import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

// OnlineAfspraken.nl REST API (XML responses, signed requests).
// Verified from https://onlineafspraken.nl/en/how-does-api-work :
//   base URL, api_key / api_salt / api_signature / method params, signing procedure.
// NOT verified: the exact method names and parameters below. The public reference page did
// not list them. Check them against the API reference in your OnlineAfspraken backend
// before enabling provider "onlineafspraken" (see docs/domli/appointments.md).
const BASE_URL = 'https://agenda.onlineafspraken.nl/APIREST';
const METHODS = { bookableTimes: 'getBookableTimes' };

export function sign(params, secret, salt) {
  const base = Object.keys(params)
    .sort()
    .map(key => `${key}${params[key]}`)
    .join('');
  return createHash('sha256').update(`${base}${secret}${salt}`).digest('hex');
}

export function buildUrl(method, params, { apiKey, apiSecret }, now = Date.now()) {
  const salt = Math.floor(now / 1000) - 1; // salt must be strictly smaller than the server time
  const all = { method, ...params };
  const query = new URLSearchParams({
    ...all,
    api_key: apiKey,
    api_salt: String(salt),
    api_signature: sign(all, apiSecret, salt),
  });
  return `${BASE_URL}?${query}`;
}

export async function callApi(method, params, credentials, fetchImpl = fetch) {
  const response = await fetchImpl(buildUrl(method, params, credentials));
  const xml = new XMLParser({ ignoreAttributes: false }).parse(await response.text());
  const root = xml.Response || xml;
  if (root.Status?.Status !== 'success') {
    throw new Error(`OnlineAfspraken ${method} failed: ${root.Status?.Message || 'unknown error'}`);
  }
  return root.Objects;
}

// Falls back to the booking link whenever the API call is not possible.
export function createOnlineAfsprakenAdapter({ apiKey, apiSecret, bookingUrl, appointmentTypeId }) {
  return {
    name: 'onlineafspraken',
    async reply({ language = 'nl' } = {}) {
      const en = language === 'en';
      try {
        const objects = await callApi(METHODS.bookableTimes, { appointmentTypeId }, { apiKey, apiSecret });
        const times = [].concat(objects?.BookableTime || []).slice(0, 3);
        if (times.length) {
          const list = times.map(t => `${t.Date} ${t.StartTime}`).join(', ');
          return en ? `The next available times are: ${list}. You can book here: ${bookingUrl}` : `De eerstvolgende beschikbare momenten zijn: ${list}. Boeken kan via: ${bookingUrl}`;
        }
      } catch (error) {
        console.error(error.message);
      }
      return en ? `You can book an appointment yourself here: ${bookingUrl}` : `U kunt zelf een afspraak inplannen via: ${bookingUrl}`;
    },
  };
}
