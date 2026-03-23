import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard/',
          '/admin/',
          '/account/',
          '/checkout/',
          '/orders/',
          '/reviews/new',
          '/api/',
        ],
      },
    ],
    sitemap: 'https://kiwimart.co.nz/sitemap.xml',
  };
}
