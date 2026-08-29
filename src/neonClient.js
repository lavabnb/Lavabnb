import { createClient } from "@neondatabase/neon-js";

// Le due variabili sotto vengono impostate su Vercel (Project Settings -> Environment Variables)
// VITE_NEON_AUTH_URL      es. https://ep-xxx.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth
// VITE_NEON_DATA_API_URL  es. https://ep-xxx.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1
export const neon = createClient({
  auth: {
    url: import.meta.env.VITE_NEON_AUTH_URL,
  },
  dataApi: {
    url: import.meta.env.VITE_NEON_DATA_API_URL,
  },
});
