/**
 * 49ers Faithful — Elevated Vector Iconography System
 * Inspired by Linear, Apple Sports, Raycast, and Stripe.
 * Crisp 24x24 geometric strokes with subtle duotone fill accents for instant visual salience.
 */

const SVG_PATHS = {
  // Primary Bottom Navigation Icons
  home: `
    <rect x="3" y="3" width="8" height="10" rx="2.2" fill="currentColor" fill-opacity="0.18"/>
    <rect x="3" y="3" width="8" height="10" rx="2.2"/>
    <rect x="13" y="3" width="8" height="6" rx="2"/>
    <rect x="13" y="11" width="8" height="10" rx="2.2" fill="currentColor" fill-opacity="0.12"/>
    <rect x="13" y="11" width="8" height="10" rx="2.2"/>
    <rect x="3" y="15" width="8" height="6" rx="2"/>
  `,
  news: `
    <rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fill-opacity="0.12"/>
    <rect x="3" y="4" width="18" height="16" rx="2.5"/>
    <polygon points="9.5 8.5 15 11.5 9.5 14.5" fill="currentColor" fill-opacity="0.28"/>
    <polygon points="9.5 8.5 15 11.5 9.5 14.5"/>
    <line x1="7" y1="17" x2="17" y2="17"/>
  `,
  football: `
    <path d="M18.8 5.2C14.8 1.2 8.2 2.2 4.7 5.7C1.2 9.2 0.2 15.8 4.2 19.8C8.2 23.8 14.8 22.8 18.3 19.3C21.8 15.8 22.8 9.2 18.8 5.2Z" fill="currentColor" fill-opacity="0.15"/>
    <path d="M18.8 5.2C14.8 1.2 8.2 2.2 4.7 5.7C1.2 9.2 0.2 15.8 4.2 19.8C8.2 23.8 14.8 22.8 18.3 19.3C21.8 15.8 22.8 9.2 18.8 5.2Z"/>
    <line x1="8.5" y1="15.5" x2="15.5" y2="8.5"/>
    <line x1="9.2" y1="11.8" x2="12.2" y2="14.8"/>
    <line x1="11.8" y1="9.2" x2="14.8" y2="12.2"/>
    <path d="M5.5 12.5L11.5 18.5"/>
    <path d="M12.5 5.5L18.5 11.5"/>
  `,
  season: `
    <rect x="3.5" y="13" width="4" height="7.5" rx="1.2" fill="currentColor" fill-opacity="0.16"/>
    <rect x="3.5" y="13" width="4" height="7.5" rx="1.2"/>
    <rect x="10" y="9" width="4" height="11.5" rx="1.2" fill="currentColor" fill-opacity="0.16"/>
    <rect x="10" y="9" width="4" height="11.5" rx="1.2"/>
    <rect x="16.5" y="4.5" width="4" height="16" rx="1.2" fill="currentColor" fill-opacity="0.24"/>
    <rect x="16.5" y="4.5" width="4" height="16" rx="1.2"/>
    <path d="M4 9.5L9.5 5.5L13.5 7.5L19.5 2.5"/>
  `,
  audio: `
    <path d="M4 13V11C4 6.58 7.58 3 12 3C16.42 3 20 6.58 20 11V13"/>
    <rect x="2.5" y="13" width="4" height="7" rx="1.8" fill="currentColor" fill-opacity="0.2"/>
    <rect x="2.5" y="13" width="4" height="7" rx="1.8"/>
    <rect x="17.5" y="13" width="4" height="7" rx="1.8" fill="currentColor" fill-opacity="0.2"/>
    <rect x="17.5" y="13" width="4" height="7" rx="1.8"/>
    <line x1="9.5" y1="11.5" x2="9.5" y2="16.5"/>
    <line x1="12" y1="9" x2="12" y2="18"/>
    <line x1="14.5" y1="12" x2="14.5" y2="16"/>
  `,

  // Header & System Controls
  vault: `
    <rect x="3" y="4" width="18" height="5" rx="1.5" fill="currentColor" fill-opacity="0.18"/>
    <rect x="3" y="4" width="18" height="5" rx="1.5"/>
    <path d="M4.5 9V18.5C4.5 19.6 5.4 20.5 6.5 20.5H17.5C18.6 20.5 19.5 19.6 19.5 18.5V9"/>
    <line x1="10" y1="13.5" x2="14" y2="13.5"/>
  `,
  settings: `
    <line x1="4" y1="6" x2="10" y2="6"/>
    <line x1="14" y1="6" x2="20" y2="6"/>
    <circle cx="12" cy="6" r="2.2" fill="currentColor" fill-opacity="0.25"/>
    <circle cx="12" cy="6" r="2.2"/>
    <line x1="4" y1="12" x2="6" y2="12"/>
    <line x1="10" y1="12" x2="20" y2="12"/>
    <circle cx="8" cy="12" r="2.2" fill="currentColor" fill-opacity="0.25"/>
    <circle cx="8" cy="12" r="2.2"/>
    <line x1="4" y1="18" x2="14" y2="18"/>
    <line x1="18" y1="18" x2="20" y2="18"/>
    <circle cx="16" cy="18" r="2.2" fill="currentColor" fill-opacity="0.25"/>
    <circle cx="16" cy="18" r="2.2"/>
  `,
  customize: `
    <path d="M7 4V20M7 4L4 7M7 4L10 7"/>
    <path d="M17 20V4M17 20L14 17M17 20L20 17"/>
  `,
  reset: `
    <path d="M3 12C3 7.03 7.03 3 12 3C15.3 3 18.18 4.78 19.74 7.42"/>
    <polyline points="20 3.5 20 8 15.5 8"/>
    <path d="M21 12C21 16.97 16.97 21 12 21C8.7 21 5.82 19.22 4.26 16.58"/>
  `,
  check: `
    <polyline points="20 6 9 17 4 12"/>
  `,
  close: `
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  `,
  arrowRight: `
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="13 6 19 12 13 18"/>
  `,
  externalLink: `
    <path d="M7 17L17 7"/>
    <polyline points="8 7 17 7 17 16"/>
  `,
  external: `
    <path d="M7 17L17 7"/>
    <polyline points="8 7 17 7 17 16"/>
  `,
  tweet: `
    <path d="M21 11.5C21 16.2 16.97 20 12 20C10.4 20 8.9 19.6 7.6 18.9L3 20L4.3 15.9C3.5 14.6 3 13.1 3 11.5C3 6.8 7.03 3 12 3C16.97 3 21 6.8 21 11.5Z" fill="currentColor" fill-opacity="0.14"/>
    <path d="M21 11.5C21 16.2 16.97 20 12 20C10.4 20 8.9 19.6 7.6 18.9L3 20L4.3 15.9C3.5 14.6 3 13.1 3 11.5C3 6.8 7.03 3 12 3C16.97 3 21 6.8 21 11.5Z"/>
  `,
  arrowUp: `
    <line x1="12" y1="19" x2="12" y2="5"/>
    <polyline points="6 11 12 5 18 11"/>
  `,
  arrowDown: `
    <line x1="12" y1="5" x2="12" y2="19"/>
    <polyline points="6 13 12 19 18 13"/>
  `,
  chevronUp: `
    <polyline points="18 15 12 9 6 15"/>
  `,
  chevronDown: `
    <polyline points="6 9 12 15 18 9"/>
  `,
  search: `
    <circle cx="11" cy="11" r="7"/>
    <line x1="20" y1="20" x2="16.2" y2="16.2"/>
  `,

  // Domain & Feature Icons
  sparkles: `
    <path d="M12 3L14.2 8.8L20 11L14.2 13.2L12 19L9.8 13.2L4 11L9.8 8.8L12 3Z" fill="currentColor" fill-opacity="0.22"/>
    <path d="M12 3L14.2 8.8L20 11L14.2 13.2L12 19L9.8 13.2L4 11L9.8 8.8L12 3Z"/>
    <path d="M19 3V6M17.5 4.5H20.5"/>
    <path d="M5 17V20M3.5 18.5H6.5"/>
  `,
  bolt: `
    <polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2" fill="currentColor" fill-opacity="0.2"/>
    <polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/>
  `,
  shieldCheck: `
    <path d="M12 2.5L19 5.5V11.5C19 16.3 15.9 20.3 12 21.8C8.1 20.3 5 16.3 5 11.5V5.5L12 2.5Z" fill="currentColor" fill-opacity="0.16"/>
    <path d="M12 2.5L19 5.5V11.5C19 16.3 15.9 20.3 12 21.8C8.1 20.3 5 16.3 5 11.5V5.5L12 2.5Z"/>
    <polyline points="9 12 11.2 14.2 15.5 9.8"/>
  `,
  swords: `
    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
    <line x1="13" y1="19" x2="19" y2="13"/>
    <line x1="16" y1="16" x2="20" y2="20"/>
    <polyline points="9.5 17.5 21 6 21 3 18 3 6.5 14.5"/>
    <line x1="5" y1="13" x2="11" y2="19"/>
    <line x1="8" y1="16" x2="4" y2="20"/>
  `,
  heartPulse: `
    <path d="M19.5 12.6L12 20.2L4.5 12.6C2.7 10.8 2.7 7.7 4.5 5.9C6.3 4.1 9.3 4.1 11.1 5.9L12 6.8L12.9 5.9C14.7 4.1 17.7 4.1 19.5 5.9C21.3 7.7 21.3 10.8 19.5 12.6Z" fill="currentColor" fill-opacity="0.15"/>
    <path d="M3 12H7.5L9.5 8.5L12.5 15.5L14.5 12H21"/>
  `,
  trade: `
    <polyline points="17 2 21 6 17 10"/>
    <path d="M3 11V9C3 7.34 4.34 6 6 6H21"/>
    <polyline points="7 22 3 18 7 14"/>
    <path d="M21 13V15C21 16.66 19.66 18 18 18H3"/>
  `,
  calendar: `
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" fill="currentColor" fill-opacity="0.12"/>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/>
    <line x1="16" y1="2.5" x2="16" y2="6.5"/>
    <line x1="8" y1="2.5" x2="8" y2="6.5"/>
    <line x1="3" y1="9.5" x2="21" y2="9.5"/>
    <circle cx="12" cy="15" r="1.6" fill="currentColor"/>
  `,
  trophy: `
    <path d="M7 4H17V10C17 12.76 14.76 15 12 15C9.24 15 7 12.76 7 10V4Z" fill="currentColor" fill-opacity="0.18"/>
    <path d="M7 4H17V10C17 12.76 14.76 15 12 15C9.24 15 7 12.76 7 10V4Z"/>
    <path d="M7 6H4V8.5C4 10.4 5.3 11.8 7 12"/>
    <path d="M17 6H20V8.5C20 10.4 18.7 11.8 17 12"/>
    <line x1="12" y1="15" x2="12" y2="20"/>
    <line x1="8" y1="20" x2="16" y2="20"/>
  `,
  compass: `
    <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.12"/>
    <circle cx="12" cy="12" r="9"/>
    <polygon points="15.8 8.2 13.6 13.6 8.2 15.8 10.4 10.4 15.8 8.2" fill="currentColor" fill-opacity="0.28"/>
    <polygon points="15.8 8.2 13.6 13.6 8.2 15.8 10.4 10.4 15.8 8.2"/>
  `,
  radar: `
    <polygon points="12 2.5 20.2 7.2 20.2 16.8 12 21.5 3.8 16.8 3.8 7.2 12 2.5" fill="currentColor" fill-opacity="0.1"/>
    <polygon points="12 2.5 20.2 7.2 20.2 16.8 12 21.5 3.8 16.8 3.8 7.2 12 2.5"/>
    <polygon points="12 6.5 16.8 9.8 15.5 16.2 8.5 15.2 7.2 9.5 12 6.5" fill="currentColor" fill-opacity="0.28"/>
    <polygon points="12 6.5 16.8 9.8 15.5 16.2 8.5 15.2 7.2 9.5 12 6.5"/>
  `,
  layers: `
    <polygon points="12 3 2 8 12 13 22 8 12 3" fill="currentColor" fill-opacity="0.2"/>
    <polygon points="12 3 2 8 12 13 22 8 12 3"/>
    <polyline points="2 12.5 12 17.5 22 12.5"/>
    <polyline points="2 17 12 22 22 17"/>
  `,
  cap: `
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor" fill-opacity="0.14"/>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5"/>
    <path d="M12 8.2V15.8"/>
    <path d="M14.3 9.7C14.3 8.8 13.3 8.3 12 8.3C10.7 8.3 9.7 8.9 9.7 9.9C9.7 11.8 14.3 11.2 14.3 13.3C14.3 14.3 13.3 14.9 12 14.9C10.7 14.9 9.7 14.3 9.7 13.4"/>
  `,
  stadium: `
    <ellipse cx="12" cy="7.5" rx="9" ry="3.5" fill="currentColor" fill-opacity="0.18"/>
    <ellipse cx="12" cy="7.5" rx="9" ry="3.5"/>
    <path d="M3 7.5V15.5C3 17.7 7 19.5 12 19.5C17 19.5 21 17.7 21 15.5V7.5"/>
    <path d="M9 19.2V15.5C9 14.4 10.3 13.5 12 13.5C13.7 13.5 15 14.4 15 15.5V19.2"/>
  `,
  mapPin: `
    <path d="M12 21C12 21 18.5 15.2 18.5 10C18.5 6.41 15.59 3.5 12 3.5C8.41 3.5 5.5 6.41 5.5 10C5.5 15.2 12 21 12 21Z" fill="currentColor" fill-opacity="0.16"/>
    <path d="M12 21C12 21 18.5 15.2 18.5 10C18.5 6.41 15.59 3.5 12 3.5C8.41 3.5 5.5 6.41 5.5 10C5.5 15.2 12 21 12 21Z"/>
    <circle cx="12" cy="10" r="2.3"/>
  `,
  mic: `
    <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" fill-opacity="0.2"/>
    <rect x="9" y="2.5" width="6" height="11" rx="3"/>
    <path d="M5.5 10.5V11C5.5 14.59 8.41 17.5 12 17.5C15.59 17.5 18.5 14.59 18.5 11V10.5"/>
    <line x1="12" y1="17.5" x2="12" y2="21.5"/>
    <line x1="8.5" y1="21.5" x2="15.5" y2="21.5"/>
  `,
  target: `
    <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.1"/>
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="5"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
  `,
  play: `
    <polygon points="6.5 4.5 19 12 6.5 19.5 6.5 4.5" fill="currentColor" fill-opacity="0.28"/>
    <polygon points="6.5 4.5 19 12 6.5 19.5 6.5 4.5"/>
  `,
  pause: `
    <rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" fill-opacity="0.28"/>
    <rect x="6.5" y="4.5" width="4" height="15" rx="1"/>
    <rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" fill-opacity="0.28"/>
    <rect x="13.5" y="4.5" width="4" height="15" rx="1"/>
  `,
  clock: `
    <circle cx="12" cy="12" r="8.8" fill="currentColor" fill-opacity="0.14"/>
    <circle cx="12" cy="12" r="8.8"/>
    <polyline points="12 7.2 12 12 15.2 14"/>
  `,
  loader: `
    <circle cx="12" cy="12" r="8.8" stroke-opacity="0.24"/>
    <path d="M12 3.2A8.8 8.8 0 0 1 20.8 12"/>
  `,
  sun: `
    <circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity="0.22"/>
    <circle cx="12" cy="12" r="4.2"/>
    <line x1="12" y1="2.5" x2="12" y2="4.8"/>
    <line x1="12" y1="19.2" x2="12" y2="21.5"/>
    <line x1="4.8" y1="4.8" x2="6.5" y2="6.5"/>
    <line x1="17.5" y1="17.5" x2="19.2" y2="19.2"/>
    <line x1="2.5" y1="12" x2="4.8" y2="12"/>
    <line x1="19.2" y1="12" x2="21.5" y2="12"/>
    <line x1="4.8" y1="19.2" x2="6.5" y2="17.5"/>
    <line x1="17.5" y1="6.5" x2="19.2" y2="4.8"/>
  `,
  moon: `
    <path d="M20.4 14.6C19.2 15.1 17.9 15.4 16.5 15.4C11.5 15.4 7.5 11.4 7.5 6.4C7.5 5 7.8 3.7 8.3 2.5C4.9 3.8 2.5 7.1 2.5 11C2.5 16 6.5 20 11.5 20C15.4 20 18.7 17.6 20.4 14.6Z" fill="currentColor" fill-opacity="0.2"/>
    <path d="M20.4 14.6C19.2 15.1 17.9 15.4 16.5 15.4C11.5 15.4 7.5 11.4 7.5 6.4C7.5 5 7.8 3.7 8.3 2.5C4.9 3.8 2.5 7.1 2.5 11C2.5 16 6.5 20 11.5 20C15.4 20 18.7 17.6 20.4 14.6Z"/>
  `,
  save: `
    <path d="M19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16L21 8V19C21 20.1 20.1 21 19 21Z" fill="currentColor" fill-opacity="0.14"/>
    <path d="M19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16L21 8V19C21 20.1 20.1 21 19 21Z"/>
    <polyline points="9 14 11.2 16.2 15.5 11.8"/>
  `,
  alert: `
    <path d="M10.3 3.9L1.8 18.5C1.1 19.7 2 21.2 3.5 21.2H20.5C22 21.2 22.9 19.7 22.2 18.5L13.7 3.9C13 2.7 11 2.7 10.3 3.9Z" fill="currentColor" fill-opacity="0.16"/>
    <path d="M10.3 3.9L1.8 18.5C1.1 19.7 2 21.2 3.5 21.2H20.5C22 21.2 22.9 19.7 22.2 18.5L13.7 3.9C13 2.7 11 2.7 10.3 3.9Z"/>
    <line x1="12" y1="9" x2="12" y2="13.5"/>
    <circle cx="12" cy="17" r="0.8" fill="currentColor"/>
  `,
  video: `
    <rect x="2.5" y="5" width="14" height="14" rx="2.2" fill="currentColor" fill-opacity="0.16"/>
    <rect x="2.5" y="5" width="14" height="14" rx="2.2"/>
    <polygon points="16.5 10 21.5 7 21.5 17 16.5 14 16.5 10" fill="currentColor" fill-opacity="0.22"/>
    <polygon points="16.5 10 21.5 7 21.5 17 16.5 14 16.5 10"/>
  `,
  plus: `
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  `,
  share: `
    <path d="M4.5 12.5V18.5C4.5 19.6 5.4 20.5 6.5 20.5H17.5C18.6 20.5 19.5 19.6 19.5 18.5V12.5"/>
    <polyline points="16 7 12 3 8 7"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  `,
  transcript: `
    <rect x="4" y="3.5" width="16" height="17" rx="2.2" fill="currentColor" fill-opacity="0.14"/>
    <rect x="4" y="3.5" width="16" height="17" rx="2.2"/>
    <line x1="8" y1="8.5" x2="16" y2="8.5"/>
    <line x1="8" y1="12.5" x2="16" y2="12.5"/>
    <line x1="8" y1="16.5" x2="13" y2="16.5"/>
  `
};

export function iconSvg(name, size = 16, extraClass = '') {
  const inner = SVG_PATHS[name] || SVG_PATHS.sparkles;
  const cls = ['ui-icon', extraClass].filter(Boolean).join(' ');
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function blockIconName(blockId) {
  switch (blockId) {
    case 'news_briefs':
      return 'news';
    case 'trade_deadline':
      return 'trade';
    case 'upcoming_matchup':
      return 'swords';
    case 'team_health':
      return 'heartPulse';
    case 'playoff_picture':
      return 'trophy';
    case 'draft_prep':
      return 'compass';
    case 'draft_live_udfa':
      return 'radar';
    case 'team_stats':
      return 'season';
    case 'roster_depth':
      return 'football';
    case 'salary_cap':
      return 'cap';
    case 'schedule_overview':
      return 'calendar';
    case 'autopodcast_ai':
      return 'audio';
    default:
      return 'sparkles';
  }
}
