
/**
 * Default SVG assets as Data URIs for the application skeleton.
 * Includes placeholders for UI, logic debugging and VFX.
 */

const HERO_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="8" fill="#3B82F6"/>
  <rect x="12" y="16" width="12" height="12" rx="2" fill="white"/>
  <rect x="40" y="16" width="12" height="12" rx="2" fill="white"/>
  <rect x="16" y="20" width="4" height="4" fill="#1D4ED8"/>
  <rect x="44" y="20" width="4" height="4" fill="#1D4ED8"/>
  <rect x="20" y="44" width="24" height="6" rx="3" fill="#1D4ED8"/>
</svg>
`;

const CRATE_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="4" fill="#F59E0B"/>
  <rect x="4" y="4" width="56" height="56" rx="2" stroke="#B45309" stroke-width="4"/>
  <path d="M4 4L60 60M60 4L4 60" stroke="#B45309" stroke-width="4"/>
  <rect x="24" y="24" width="16" height="16" fill="#D97706" stroke="#B45309" stroke-width="2"/>
</svg>
`;

const NUM_1_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="32" fill="#1E293B"/>
  <path d="M30 18H36V46H30V24H26V18H30Z" fill="#3B82F6"/>
</svg>
`;

const NUM_2_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="32" fill="#1E293B"/>
  <path d="M22 22C22 19.7909 23.7909 18 26 18H38C40.2091 18 42 19.7909 42 22V28C42 30.2091 40.2091 32 38 32H30V38H42V44H26C23.7909 44 22 42.2091 22 40V34C22 31.7909 23.7909 30 26 30H34V24H22V22Z" fill="#3B82F6"/>
</svg>
`;

const NUM_3_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="32" fill="#1E293B"/>
  <path d="M22 18H42V24H30V28H38C40.2091 28 42 29.7909 42 32V40C42 42.2091 40.2091 44 38 44H26C23.7909 44 22 42.2091 22 40V38H28V40H36V32H22V18Z" fill="#3B82F6"/>
</svg>
`;

const VFX_FLASH_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 4L36 28L60 32L36 36L32 60L28 36L4 32L28 28L32 4Z" fill="#FDE047"/>
  <circle cx="32" cy="32" r="8" fill="white"/>
</svg>
`;

const TARGET_SVG = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="24" stroke="#22C55E" stroke-width="4"/>
  <circle cx="32" cy="32" r="4" fill="#22C55E"/>
  <rect x="30" y="4" width="4" height="12" fill="#22C55E"/>
  <rect x="30" y="48" width="4" height="12" fill="#22C55E"/>
  <rect x="4" y="30" width="12" height="4" fill="#22C55E"/>
  <rect x="48" y="30" width="12" height="4" fill="#22C55E"/>
</svg>
`;

export const DEFAULT_ASSETS = [
    {
        id: 'default-hero',
        src: `data:image/svg+xml;base64,${btoa(HERO_SVG.trim())}`,
        name: 'hero_placeholder.svg',
        width: 64,
        height: 64
    },
    {
        id: 'default-crate',
        src: `data:image/svg+xml;base64,${btoa(CRATE_SVG.trim())}`,
        name: 'crate_placeholder.svg',
        width: 64,
        height: 64
    },
    {
        id: 'num-1',
        src: `data:image/svg+xml;base64,${btoa(NUM_1_SVG.trim())}`,
        name: 'debug_1.svg',
        width: 64,
        height: 64
    },
    {
        id: 'num-2',
        src: `data:image/svg+xml;base64,${btoa(NUM_2_SVG.trim())}`,
        name: 'debug_2.svg',
        width: 64,
        height: 64
    },
    {
        id: 'num-3',
        src: `data:image/svg+xml;base64,${btoa(NUM_3_SVG.trim())}`,
        name: 'debug_3.svg',
        width: 64,
        height: 64
    },
    {
        id: 'vfx-flash',
        src: `data:image/svg+xml;base64,${btoa(VFX_FLASH_SVG.trim())}`,
        name: 'vfx_flash.svg',
        width: 64,
        height: 64
    },
    {
        id: 'target-crosshair',
        src: `data:image/svg+xml;base64,${btoa(TARGET_SVG.trim())}`,
        name: 'target.svg',
        width: 64,
        height: 64
    }
];
