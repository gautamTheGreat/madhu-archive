/**
 * Safely resolves media URLs by prepending the Vite BASE_URL.
 * This ensures paths work correctly on both local preview and GitHub Pages.
 * 
 * @param {string} path - The media path from the data (e.g., "/media/file.jpg")
 * @returns {string} - The resolved, URL-encoded path relative to the site root
 */
export const getMediaUrl = (path) => {
  if (!path) return '';
  
  // If it's already an absolute URL (e.g. from a CDN), return it as is
  if (path.startsWith('http')) return path;
  
  // baseUrl from Vite (e.g., "/madhu-archive/").
  // It always ends with a slash in our config.
  const baseUrl = import.meta.env.BASE_URL || '/';
  
  // Remove leading slash from the path if it exists, so we don't end up with "//"
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // Combine base and path
  const fullUrl = `${baseUrl}${cleanPath}`;
  
  // Replace spaces with %20 for valid URLs
  return fullUrl.replace(/ /g, '%20');
};
