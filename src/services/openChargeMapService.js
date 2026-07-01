import axios from 'axios';

const OCM_BASE = 'https://api.openchargemap.io/v3';

export async function findNearestStation(lat, lng, maxResults = 3, distanceKm = 10) {
  try {
    const response = await axios.get(`${OCM_BASE}/poi`, {
      params: {
        output: 'json',
        latitude: lat,
        longitude: lng,
        distance: distanceKm,
        maxresults: maxResults,
        compact: true,
        verbose: false
      },
      timeout: 10000
    });

    if (!response.data || response.data.length === 0) {
      return { success: false, error: 'No stations found nearby' };
    }

    const stations = response.data.map((station, index) => ({
      name: station.AddressInfo?.Title || `Station ${index + 1}`,
      address: [
        station.AddressInfo?.AddressLine1,
        station.AddressInfo?.Town,
        station.AddressInfo?.StateOrProvince
      ].filter(Boolean).join(', '),
      distance: station.AddressInfo?.Distance?.toFixed(1) || null,
      latitude: station.AddressInfo?.Latitude,
      longitude: station.AddressInfo?.Longitude,
      connectorTypes: station.Connections?.map(c => c.ConnectionType?.Title).filter(Boolean) || [],
      status: station.StatusType?.Title || 'Unknown'
    }));

    return {
      success: true,
      stations,
      nearest: stations[0]
    };

  } catch (error) {
    console.error('OpenChargeMap error:', error.message);
    return {
      success: false,
      error: `Failed to lookup stations: ${error.message}`
    };
  }
}

export function parseLocation(text) {
  if (!text) return null;

  // Try to parse as "lat, lng" or "lat lng" coordinates
  const coordMatch = text.match(/(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng, type: 'coordinates' };
    }
  }

  // Could add geocoding here (e.g., Mapbox, Google Maps API)
  // For now, return the raw text — the AI can interpret it
  return { text, type: 'text' };
}
