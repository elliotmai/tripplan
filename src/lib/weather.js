// Open-Meteo — completely free, no API key required
// https://open-meteo.com/

const WMO_CODES = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Foggy', icon: '🌫️' },
  48: { label: 'Icy fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '❄️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  80: { label: 'Rain showers', icon: '🌦️' },
  81: { label: 'Rain showers', icon: '🌧️' },
  82: { label: 'Violent showers', icon: '⛈️' },
  85: { label: 'Snow showers', icon: '🌨️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  99: { label: 'Thunderstorm w/ hail', icon: '⛈️' },
}

export function getWeatherInfo(code) {
  return WMO_CODES[code] || { label: 'Unknown', icon: '🌡️' }
}

export async function fetchWeatherForTrip(lat, lon, startDate, endDate) {
  if (!lat || !lon) return null
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', lat)
    url.searchParams.set('longitude', lon)
    url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
    url.searchParams.set('timezone', 'auto')
    url.searchParams.set('start_date', startDate)
    url.searchParams.set('end_date', endDate)
    url.searchParams.set('temperature_unit', 'celsius')

    const res = await fetch(url.toString())
    if (!res.ok) return null
    const data = await res.json()

    const { daily } = data
    return daily.time.map((date, i) => ({
      date,
      code: daily.weathercode[i],
      maxTemp: Math.round(daily.temperature_2m_max[i]),
      minTemp: Math.round(daily.temperature_2m_min[i]),
      precipProb: daily.precipitation_probability_max[i],
      ...getWeatherInfo(daily.weathercode[i]),
    }))
  } catch (e) {
    console.error('Weather fetch failed:', e)
    return null
  }
}

export async function geocodeCity(city) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    const res = await fetch(url)
    const data = await res.json()
    if (data.results?.length) {
      const r = data.results[0]
      return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country }
    }
    return null
  } catch {
    return null
  }
}
