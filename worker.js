const ALLOWED_ORIGIN = '*'; // Tighten this to your GitHub Pages URL once deployed

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // Route: /estimate — calls Anthropic to estimate macros
    if (url.pathname === '/estimate' && request.method === 'POST') {
      const { foodLog } = await request.json();

      const prompt = `You are a nutrition expert. Estimate the macros for the following food log.
Return ONLY a valid JSON object with no markdown, no explanation, no preamble.
The JSON must have exactly these keys: protein, carbs, fat, kcal (all numbers, rounded to nearest integer).

Food log:
${foodLog}

Important context:
- This person is 78.4kg, training 4-5 days/week
- Portions are Australian standard serves unless specified
- "slice sourdough" = ~40g standard slice
- "handful nuts" = ~30g
- "cup" = 250ml Australian cup
- Collagen protein is lower quality than whey — count it but note it separately if needed
- Return only the JSON object, nothing else.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json();
      const text = data.content?.[0]?.text || '{}';

      let macros;
      try {
        macros = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch {
        macros = { protein: 0, carbs: 0, fat: 0, kcal: 0, error: 'Parse error' };
      }

      return new Response(JSON.stringify(macros), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Route: /log — writes a nutrition entry to Notion
    if (url.pathname === '/log' && request.method === 'POST') {
      const { date, name, macros, flags, notes } = await request.json();

      const proteinTarget = 160;
      const carbsTarget = 285;
      const fatTarget = 95;
      const kcalTarget = 2950;

      const proteinMet = macros.protein >= proteinTarget;
      const carbsMet = macros.carbs >= carbsTarget;
      const fatMet = macros.fat >= fatTarget;
      const kcalMet = macros.kcal >= kcalTarget;

      let rating = 'Under target';
      const targetsHit = [proteinMet, carbsMet, fatMet, kcalMet].filter(Boolean).length;
      if (targetsHit === 4) rating = 'Full house';
      else if (proteinMet && carbsMet) rating = 'On target';
      else if (targetsHit >= 2) rating = 'Partial';

      const body = {
        parent: { database_id: env.NOTION_DATABASE_ID },
        properties: {
          Name: { title: [{ text: { content: name } }] },
          Date: { date: { start: date } },
          'Protein (g)': { number: macros.protein },
          'Carbs (g)': { number: macros.carbs },
          'Fat (g)': { number: macros.fat },
          'Calories (kcal)': { number: macros.kcal },
          'Protein target met': { checkbox: proteinMet },
          'Carbs target met': { checkbox: carbsMet },
          'Fat target met': { checkbox: fatMet },
          'Calories target met': { checkbox: kcalMet },
          'Day rating': { select: { name: rating } },
          'Training day': { checkbox: flags.trainingDay || false },
          'Pre-achilles done': { checkbox: flags.preAchilles || false },
          'Post-workout shake': { checkbox: flags.postWorkout || false },
          'Evening snack': { checkbox: flags.eveningSnack || false },
          'Gluten exposure': { checkbox: flags.glutenExposure || false },
          Notes: { rich_text: [{ text: { content: notes || '' } }] },
        },
      };

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.object === 'error') {
        return new Response(JSON.stringify({ success: false, error: result.message }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, notionUrl: result.url }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};
