import { createApp } from '../src/app';

// Vercel Node function adapter: reuse the Express application without calling
// app.listen(), because the platform supplies the request/response objects.
const app = createApp();

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: any, res: any) {
  return app(req, res);
}
