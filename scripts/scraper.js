import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const urls = [
  // Основные
  "https://khai.edu",
  "https://khai.edu/news/novini",
  "https://khai.edu/universitet",
  "https://khai.edu/vstup",
  "https://khai.edu/studentu",
  "https://khai.edu/nauka",
  // Расписание
  "https://profkomstud.khai.edu/schedule/group/525st",
  "https://profkomstud.khai.edu/schedule/room/227s",
  "https://profkomstud.khai.edu/schedule/employee/Zemlianko-Heor",
  "https://profkomstud.khai.edu/schedule/department/702",
  "https://profkomstud.khai.edu/schedule/student/Fedorenko-Daria-Dmytrivna",
  // Учебные платформы
  "https://profkomstud.khai.edu",
  "https://mentor.khai.edu",
  "https://pilot.khai.edu/pilot/login.html",
  "https://epos.khai.edu/login",
  // Конференции и наука
  "https://khai.edu/miznarodnij-kongres-dvigunobudivnikiv",
  "https://scific-conference.github.io/SCIFIC-conference/en/index.html",
  "https://khai.edu/miznarodna-naukovo-prakticna-konferencia-ludina-kultura-tehnika-v-novomu-tisacolitti",
  "https://khai.edu/5th-international-workshop-of-it-professionals-on-artificial-intelligence-profit-ai-2025",
  "https://khai.edu/vseukrainska-naukovo-prakticna-konferencia-z-miznarodnou-ucastu-aktualni-pitanna-fizicnogo-vihovanna-sportu-zdorovogo-sposobu-ta-akosti-zitta-riznih-verstv-naselenna",
  "https://khai.edu/vseukrainska-naukovo-prakticna-konferencia-studentiv-i-molodih-vcenih-psihologia-v-sucasnomu-sviti",
  "https://khai.edu/vseukrayinska-molodizhna-naukovo-tekhnichna-konferentsiya",
  "https://khai.edu/naukovo-prakticna-konferencia-studentiv-i-molodih-vcenih-sucasni-problemi-raketno-kosmicnoi-tehniki-i-tehnologii",
  "https://khai.edu/vseukrainska-konferencia-novi-tehnologii-v-masinobuduvanni",
  "https://fae-conference.khai.edu",
  "https://khai.edu/vseukrainska-naukovo-prakticna-konferencia-molodih-ucenih-ta-ucnivskoi-molodi-ekonomika-ta-publicne-upravlinna-novi-vikliki-ta-risenna",
  "https://ictm.khai.edu",
  // Приёмная комиссия
  "https://assistant.khai.edu",
  "https://khai.edu/pravila-prijomu",
  "https://khai.edu/obrati-spetsialnist",
  "https://khai.edu/bakalavrat",
  "https://khai.edu/magistratura",
  "https://khai.edu/vstup-dlya-maybutnikh-aspirantiv-ta-doktorantiv",
  // Внешние официальные источники
  "https://testportal.gov.ua",
  "https://mon.gov.ua",
  "https://ntd.nauka.gov.ua",
  "https://osvita.diia.gov.ua",
  "https://mriia.gov.ua/app",
  "https://imzo.gov.ua",
  "https://studyinukraine.gov.ua",
  "https://osvita.ua",
  "https://vseosvita.ua",
  "https://mincult.gov.ua",
  "https://moz.gov.ua/uk"
];

const ROLES = ['Студент', 'Викладач', 'Адміністрація', 'Абітурієнт'];

// Simple heuristic to assign categories and roles based on URL
function getMetadataForUrl(url) {
  const metadata = { category: 'Загальне', roles: ['Всі'] };
  
  if (url.includes('/vstup') || url.includes('/bakalavrat') || url.includes('/magistratura') || url.includes('/pravila-prijomu') || url.includes('testportal') || url.includes('assistant.khai.edu')) {
    metadata.category = 'Вступ';
    metadata.roles = ['Абітурієнт'];
  } else if (url.includes('/studentu') || url.includes('profkomstud') || url.includes('mentor') || url.includes('pilot') || url.includes('epos')) {
    metadata.category = 'Навчання';
    metadata.roles = ['Студент', 'Викладач'];
  } else if (url.includes('/nauka') || url.includes('konferencia') || url.includes('conference') || url.includes('kongres')) {
    metadata.category = 'Наука';
    metadata.roles = ['Викладач', 'Студент', 'Адміністрація'];
  } else if (url.includes('/universitet') || url.includes('gov.ua') || url.includes('mon.gov.ua')) {
    metadata.category = 'Офіційна інформація';
    metadata.roles = ['Адміністрація', 'Викладач'];
  }
  
  return metadata;
}

// Function to chunk text
function chunkText(text, maxLen = 300) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (let sentence of sentences) {
    if ((currentChunk.length + sentence.length) > maxLen && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

// Extract keywords simply
function extractKeywords(text) {
  const words = text.toLowerCase().replace(/[.,!?;:()]/g, '').split(/\s+/);
  // filter short words
  const longWords = words.filter(w => w.length > 4);
  // get unique
  const unique = [...new Set(longWords)];
  // return top 10
  return unique.slice(0, 10);
}

async function scrape() {
  const knowledgeBase = [];
  let idCounter = 1;

  for (const url of urls) {
    console.log(`Scraping ${url}...`);
    try {
      const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (!response.ok) {
        console.warn(`Failed to fetch ${url}: ${response.statusText}`);
        continue;
      }
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Remove scripts, styles, nav, footer, etc to get main content
      $('script, style, nav, footer, header, noscript, iframe').remove();
      
      // get text from body or main
      let text = $('main').text() || $('body').text();
      text = text.replace(/\s+/g, ' ').trim();

      if (text.length < 50) continue; // Skip too short pages

      const { category, roles } = getMetadataForUrl(url);
      const chunks = chunkText(text, 300);

      for (const chunk of chunks) {
        if (chunk.length < 30) continue; // skip very small chunks
        
        knowledgeBase.push({
          id: String(idCounter++),
          source_url: url,
          category: category,
          roles: roles,
          text: chunk,
          keywords: extractKeywords(chunk),
          last_updated: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`Error scraping ${url}: ${error.message}`);
    }
    
    // Add small delay to avoid being blocked
    await new Promise(r => setTimeout(r, 500));
  }

  const outputPath = path.join(__dirname, '../public/knowledge_base.json');
  fs.writeFileSync(outputPath, JSON.stringify(knowledgeBase, null, 2), 'utf-8');
  console.log(`Saved ${knowledgeBase.length} chunks to public/knowledge_base.json`);
}

scrape();
