/* Site-wide constants. The GitHub repository is named only here. */
export const REPO = 'meloer101/terminal-reborn'
export const gh = (path = ''): string => `https://github.com/${REPO}${path}`

/** A path under the site's base (Vercel serves at "/", GitHub Pages under "/terminal-reborn/"). */
export const withBase = (path: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
