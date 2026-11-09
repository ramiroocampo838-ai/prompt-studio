/** @type {import('next').NextConfig} */
const nextConfig = {
  // The API routes spawn ffmpeg/python and write to data/, so keep file tracing off the data folder.
  outputFileTracingExcludes: { "*": ["data/**"] },
}

export default nextConfig
