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

      text = text.split(/©/)[0];
      text = text.replace(/\r/g, '').trim();

      const lines = text.split('\n').map(l => l.trim().replace(/\t/g, ' ').trim());

      const couplets = [];
      const refrains = [];
      let currentBlock = [];
      
      const commitCurrentBlock = () => {
          if (currentBlock.length > 0) {
              const blockText = currentBlock.join('\n').trim();
              if (/paroles et musique/i.test(blockText) || /no\./i.test(blockText) || /éditions de l'emmanuel/i.test(blockText)) {
                // Ignore metadata blocks
              } else if (/^\d+\.?/.test(blockText)) {
                  couplets.push(blockText.replace(/^\d+\.?\s*/, ''));
              } else if (/^(R\.|REFRAIN)/i.test(blockText)) {
                  refrains.push(blockText.replace(/^(R\.|REFRAIN)\s*\d*\s*/i, ''));
              } else if (blockText) {
                  refrains.push(blockText);
              }
          }
          currentBlock = [];
      };

      for (const line of lines) {
          if (line.trim() === '') {
              commitCurrentBlock();
          } else {
              currentBlock.push(line);
          }
      }
      commitCurrentBlock();

      const uniqueRefrains = [...new Set(refrains.filter(r => r.length > 0))].join('\n\n').trim();

      return { refrain: uniqueRefrains, couplet: couplets };
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