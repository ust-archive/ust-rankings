# DigitalOcean is the sole deployment target

UST Rankings deploys as a Node/Docker application to DigitalOcean App Platform in Singapore, with PostgreSQL and Spaces kept on standard protocols. DigitalOcean was chosen over Vercel and Cloudflare for predictable cost, full Node.js compatibility, and lower platform coupling; Vercel is not an active deployment or observability target, so deployment workflows, scheduled maintenance, and runtime configuration must target the DigitalOcean application.
