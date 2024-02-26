import {type NextRequest, NextResponse} from 'next/server';

export async function GET(request: NextRequest) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  return NextResponse.json(await redeploy());
}

async function redeploy() {
  const API = `https://api.vercel.com/v13/deployments?${new URLSearchParams({forceNew: '1'}).toString()}`;
  return fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    },
    body: JSON.stringify({
      deploymentId: process.env.DEPLOYMENT_ID,
      name: `Cron Deployment ${new Date().toISOString()}`,
    }),
  });
}
