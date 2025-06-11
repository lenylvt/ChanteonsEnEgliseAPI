import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const app = express();
const PORT = 3000;

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

// Recherche de chants
app.get('/chants', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'query param required' });

  try {
    // Récupérer le jeton CSRF
    const { data: searchPage } = await client.get('https://www.chantonseneglise.fr/catalogue/recherche');
    let $ = cheerio.load(searchPage);
    const token = $('input[name="catalogue_search[_token]"]').val();

    if (!token) {
      return res.status(500).json({ error: 'Jeton CSRF introuvable' });
    }

    // Envoi du formulaire de recherche
    const response = await client.post(
      'https://www.chantonseneglise.fr/catalogue/recherche',
      new URLSearchParams({
        'catalogue_search[titre]': query,
        'catalogue_search[_token]': token,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    $ = cheerio.load(response.data);
    const results = [];

    // Pour chaque résultat, extraire titre, auteur, compositeur, id
    $('.d-flex.justify-content-between.align-items-center.py-2.border-top').each((i, el) => {
      const titleContainer = $(el).find('.flex-grow-1 .d-flex > div').first();
      const title = titleContainer.clone().children().remove().end().text().trim();
      const details = $(el).find('.small.d-inline').text().trim();
      const code = $(el).find('strong').text().trim();
      const button = $(el).find('button[data-bs-target]');
      const detailId = button.attr('data-bs-target') || '';
      const match = detailId.match(/#detail-(\d+)/);
      const id = match ? match[1] : null;

      if (id) {
        results.push({ id, title, details, code });
      }
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Récupération du texte d'un chant
app.get('/chant/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const response = await client.get(`https://www.chantonseneglise.fr/voir-texte/${id}`);
    const $ = cheerio.load(response.data);

    const h1 = $('h1').first().text().trim();
    const auteur = $('div:contains("Auteur :")').text().replace('Auteur :', '').trim();
    const compositeur = $('div:contains("Compositeur :")').text().replace('Compositeur :', '').trim();
    const editeur = $('div:contains("Editeur :")').text().replace('Editeur :', '').trim();
    const cote = $('div:contains("Cote Secli :")').text().replace('Cote Secli :', '').trim();

    const texteHtml = $('p.py-4').html();
    const texte = texteHtml
      ? texteHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .trim()
      : '';

    const parseLyrics = (text) => {
      if (!text) return { refrain: '', couplet: [] };

      text = text.replace(/\r/g, '').replace(/\t/g, ' ').trim();
      text = text.split(/©/)[0].trim(); // Remove copyright

      const blocks = text.split(/\n\s*\n/);
      
      const couplets = [];
      let refrains = [];
      let intro = [];
      let lyricsStarted = false;

      for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (!trimmedBlock) continue;

        if (/^\d+\.?/.test(trimmedBlock)) {
          lyricsStarted = true;
          couplets.push(trimmedBlock.replace(/^\d+\.?\s*/, ''));
        } else if (/^(R\.|REFRAIN)/i.test(trimmedBlock)) {
          lyricsStarted = true;
          refrains.push(trimmedBlock.replace(/^(R\.|REFRAIN)\s*\d*\s*/i, ''));
        } else if (!lyricsStarted) {
          intro.push(trimmedBlock);
        }
      }

      let refrainText = [...new Set(refrains)].join('\n\n').trim();

      if (!refrainText && intro.length > 0) {
        let introText = intro.join('\n\n').trim();
        introText = introText.split(/No\. \d+-\d+/)[0].trim();
        introText = introText.replace(/Paroles et musique : .*/i, '').trim();
        if (introText) {
          refrainText = introText;
        }
      }
      
      if (refrainText) {
          const refrainLines = refrainText.split('\n').map(l => l.trim());
          const uniqueLines = [...new Set(refrainLines)];
          if (uniqueLines.length === 1 && refrainLines.length > 1) {
              refrainText = uniqueLines[0];
          }
      }

      return { refrain: refrainText, couplet: couplets };
    };

    const lyrics = parseLyrics(texte);

    res.json({
      id,
      nom: h1,
      refrain: lyrics.refrain,
      couplet: lyrics.couplet,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
app.listen(PORT, () => {
  console.log(`API MesseSong en écoute sur http://localhost:${PORT}`);
});
*/

export default app;