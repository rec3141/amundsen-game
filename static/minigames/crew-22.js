// Guided examples remain visible during practice; help and retries are free.
import { LEGS, createSession, startLeg, draw, answer, hint, worth, summary, syllables } from './crew-22-model.js';
import { SERIES, VOWELS } from './crew-22-lexicon.js';
import { PAGES, TURNER_ROWS, describe, turnerText } from './crew-22-logic.js';
import { text } from '../i18n-text.js';

const stylesheet = new URL('./crew-22.css', import.meta.url).href;
const escape = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const KEYS = ['1', '2', '3', '4'];

export const game = {
  get title() { return text('Inuktitut'); },
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let state = createSession(expedition, Date.now() >>> 0);
    let alive = true, submitted = false, cursor = 0, chartOpen = false;
    // Build cards take two picks; `pickRoot`/`pickSuffix` hold them and `row` says which row the keys address.
    let pickRoot = -1, pickSuffix = -1, row = 'roots';
    // The primer overlays the stage; `turner` is the row index into TURNER_ROWS, the vowel column and the two toggles.
    const primer = { open: false, page: 0, turner: { ri: 1, vi: 0, long: false, final: false }, text: '' };
    const TURN_PAGE = PAGES.findIndex(p => p.demo === 'turner');
    // The workbench starts on the nearest community's name when every letter of it has a glyph, else on nanuq.
    const nearName = (state.near?.place.name || '').toLowerCase();
    primer.text = nearName && syllables(nearName).every(t => !t.raw) ? nearName : 'nanuq';
    root.innerHTML = `<section class="ik-game" tabindex="-1" aria-label="Inuktitut">
      <link rel="stylesheet" href="${stylesheet}">
      <div class="ik-heading">
        <div><p class="ik-kicker" data-where></p><h3>Inuktitut<span class="ik-syl">ᐃᓄᒃᑎᑐᑦ</span></h3><p class="ik-sub">Learn a little, try it together: shapes, words, and names on the chart.</p></div>
        <div class="ik-meters">
          <div class="ik-meter"><strong data-points>0</strong><span>points</span></div>
          <div class="ik-meter"><strong data-streak>0</strong><span>practised</span></div>
          <div class="ik-meter"><strong data-leg>–</strong><span>leg</span></div>
        </div>
      </div>
      <div class="ik-legs" data-legs></div>
      <div class="ik-layout">
        <div class="ik-stage">
          <div class="ik-card" data-card></div>
          <div class="ik-card ik-primer" data-primer hidden tabindex="-1" role="region" aria-label="How the syllabics work"></div>
          <div class="ik-actions" data-actions>
            <button type="button" data-action="hint">Show me <kbd>H</kbd></button>
            <button type="button" data-action="chart" aria-pressed="false">Syllabary <kbd>C</kbd></button>
            <button type="button" data-action="logic">How it works <kbd>L</kbd></button>
            <button type="button" data-action="next" data-next class="ik-next">Next <kbd>Enter</kbd></button>
          </div>
        </div>
        <aside class="ik-side">
          <div class="ik-panel ik-chart" data-chart hidden><h5>Syllabary <span>row: consonant · column: vowel · click a glyph to turn it</span></h5><div data-chart-table></div></div>
          <div class="ik-panel"><h5>Learned this watch <span data-learned-count></span></h5><ol class="ik-learned" data-learned aria-label="Words learned"></ol></div>
        </aside>
      </div>
      <p class="ik-live" role="status" aria-live="polite" data-live></p>
      <p class="ik-hint"><kbd>1</kbd>–<kbd>4</kbd> pick · <kbd>←→↑↓</kbd>/<kbd>WASD</kbd> move · <kbd>Enter</kbd>/<kbd>Space</kbd> commit or next · <kbd>H</kbd> free help · <kbd>C</kbd> syllabary · <kbd>Backspace</kbd> unpick · <span data-hint-extra></span></p>
    </section>`;
    const panel = root.querySelector('.ik-game');
    const find = selector => panel.querySelector(selector);
    panel.focus();

    // ---------- static parts ----------
    function renderWhere() {
      const near = state.near;
      const pos = Number.isFinite(expedition?.lat) ? `${Math.abs(expedition.lat).toFixed(1)}°${expedition.lat >= 0 ? 'N' : 'S'} ${Math.abs(expedition.lon).toFixed(1)}°${expedition.lon >= 0 ? 'E' : 'W'}` : 'position unknown';
      find('[data-where]').innerHTML = near
        ? `UNDERWAY · ${escape(pos)} · nearest community <span class="ik-syl">${escape(near.place.s || near.place.name)}</span> ${escape(near.place.name)}${near.place.english && near.place.english !== near.place.name ? ` (${escape(near.place.english)})` : ''}, ${Math.round(near.km)} km`
        : `UNDERWAY · ${escape(pos)}`;
    }
    function renderChartTable() {
      const head = `<tr><th></th>${VOWELS.map(v => `<th>${v}</th>`).join('')}<th>final</th></tr>`;
      const rows = SERIES.map(r => `<tr data-row="${r.c}"><th>${r.c || '·'}</th>${r.glyphs.map((g, i) => `<td class="ik-syl" data-cell="${r.c}:${i}" title="${r.c}${VOWELS[i]}: open in the turner">${g}</td>`).join('')}<td class="ik-syl ik-final" data-cell="${r.c}:f" title="final ${r.c}: open in the turner">${r.final}</td></tr>`).join('');
      find('[data-chart-table]').innerHTML = `<table>${head}${rows}</table>`;
    }
    function litChart(card, hit) {
      panel.querySelectorAll('[data-cell]').forEach(td => td.classList.remove('ik-lit', 'ik-hit'));
      panel.querySelectorAll('[data-row]').forEach(tr => tr.classList.remove('ik-lit-row'));
      if (card?.kind === 'spell') { for (const c of card.rows) find(`[data-row="${c}"]`)?.classList.add('ik-lit-row'); return; }
      if (!card || (card.kind !== 'glyph' && card.kind !== 'sound')) return;
      const tr = find(`[data-row="${card.row}"]`);
      tr?.classList.add('ik-lit-row');
      tr?.querySelectorAll('[data-cell]').forEach(td => td.classList.add('ik-lit'));
      if (card.vi >= 0) panel.querySelectorAll(`[data-cell$=":${card.vi}"]`).forEach(td => td.classList.add('ik-lit'));
      if (hit) find(`[data-cell="${card.row}:${card.vi >= 0 ? card.vi : 'f'}"]`)?.classList.add('ik-hit');
    }
    function setChart(open) {
      chartOpen = open;
      find('[data-chart]').hidden = !open;
      find('[data-action="chart"]').setAttribute('aria-pressed', String(open));
    }
    function renderLegs() {
      find('[data-legs]').innerHTML = LEGS.map((leg, i) => {
        const deck = state.decks[i], stats = state.legStats[i];
        const dots = deck.map((card, k) => `<i class="${dotClass(i, k)}"></i>`).join('');
        return `<div class="ik-leg ${i === state.leg ? 'ik-now' : i < state.leg ? 'ik-done' : ''}"><b>${i + 1}. ${leg.name}<span class="ik-syl">${leg.inuk}</span></b><small>${leg.roman} · ${leg.points} points a card</small><span class="ik-dots" aria-label="${stats.correct} of ${deck.length} right">${dots}</span></div>`;
      }).join('');
      find('[data-leg]').textContent = state.leg >= 0 && state.leg < LEGS.length ? `${state.leg + 1}/3` : state.phase === 'end' ? '3/3' : '–';
    }
    // Each completed practice card lights a progress dot.
    const outcomes = [{}, {}, {}];
    const dotClass = (leg, k) => ({ ok: 'ik-ok', half: 'ik-half', bad: 'ik-bad' }[outcomes[leg][k]] || '');
    function renderMeters() {
      find('[data-points]').textContent = String(state.score);
      find('[data-streak]').textContent = String(state.correct);
    }
    function renderLearned() {
      const list = find('[data-learned]');
      list.innerHTML = state.learned.length ? state.learned.map(l => `<li><span class="ik-syl">${escape(l.s)}</span><span><b>${escape(l.w)}</b> <small>${escape(l.en)}</small></span></li>`).join('') : '<li class="ik-none">Practise a word and keep it here to refer to.</li>';
      list.scrollTop = list.scrollHeight;
      find('[data-learned-count]').textContent = state.learned.length ? `${state.learned.length}` : '';
    }
    function live(text) { find('[data-live]').textContent = text; }
    function actions({ hint: h = false, next = false, nextLabel = 'Next' }) {
      find('[data-action="hint"]').disabled = !h;
      // The action bar's own Next button; cards carry their own data-action="next" buttons too.
      const n = find('[data-next]');
      n.disabled = !next; n.innerHTML = `${escape(nextLabel)} <kbd>Enter</kbd>`;
    }

    // ---------- card views ----------
    function renderIntro() {
      find('[data-card]').innerHTML = `<div class="ik-brief"><p class="ik-brief-kicker">LANGUAGE WATCH</p>
        <h4>Tunngasugit<span class="ik-syl">ᑐᙵᓱᒋᑦ</span></h4>
        <p>Start with one shape: ᐱ pi, ᐳ pu, ᐸ pa. Turning the shape changes its vowel. A dot makes the vowel long: ᐲ pii.</p>
        <p>We’ll explore 14 short examples together. Read each example, then match it below. Keep the example open as long as you like. Help and retries are free, and there’s no timer.</p>
        <p class="ik-brief-small">Start with six writing examples, then four everyday words and four names or word-building examples. The interactive “How it works” guide is always available.</p>
        <div class="ik-go-row"><button type="button" class="ik-go" data-action="next">Begin the watch <kbd>Enter</kbd></button><button type="button" class="ik-go ik-go-quiet" data-action="logic">How the writing works <kbd>L</kbd></button></div></div>`;
      actions({ next: true, nextLabel: 'Begin' });
      find('[data-hint-extra]').textContent = 'L explains the writing · Escape closes the operation';
    }
    function renderBrief() {
      const leg = LEGS[state.leg];
      find('[data-card]').innerHTML = `<div class="ik-brief"><p class="ik-brief-kicker">LEG ${state.leg + 1} OF 3 · ${escape(leg.points)} POINTS A CARD</p>
        <h4>${escape(leg.name)}<span class="ik-syl">${leg.inuk}</span> <small style="font:14px system-ui,sans-serif;color:#b9d0d6">${escape(leg.roman)}</small></h4>
        <p>${escape(leg.brief)}</p>
        ${state.leg === 2 && state.near ? `<p class="ik-brief-small">The first name is the nearest community to the ship: ${escape(state.near.place.name)}, ${Math.round(state.near.km)} km away.</p>` : ''}
        <div class="ik-go-row"><button type="button" class="ik-go" data-action="next">Learn together <kbd>Enter</kbd></button>${state.leg === 0 ? '<button type="button" class="ik-go ik-go-quiet" data-action="logic">How the system works <kbd>L</kbd></button>' : ''}</div></div>`;
      actions({ next: true, nextLabel: 'Learn' });
      if (state.leg === 0) setChart(true);
    }
    function optionButton(option, i, extra = '') {
      const syl = option.label && /[᐀-ᙿ]/.test(option.label);
      const big = syl && option.label.length <= 2, mid = syl && !big && !option.sub;
      return `<button type="button" data-option="${i}" ${extra} aria-label="${escape(option.label)}${option.sub ? `, ${escape(option.sub)}` : ''}">
        <span class="ik-key">${KEYS[i]}</span><span class="ik-opt"><b class="${syl ? 'ik-syl' : ''} ${big ? 'ik-big' : mid ? 'ik-mid' : ''}">${escape(option.label)}</b>${option.sub ? `<small>${escape(option.sub)}${option.gloss ? ` · ${escape(option.gloss)}` : ''}</small>` : option.gloss ? `<small>${escape(option.gloss)}</small>` : ''}</span></button>`;
    }
    function promptClass(card) {
      if (card.kind === 'gloss' || card.kind === 'build') return 'ik-prompt ik-en';
      if (card.kind === 'sound' || card.roman) return 'ik-prompt ik-roman';
      return 'ik-prompt ik-syl';
    }
    function renderAsk() {
      const card = state.card;
      cursor = 0; pickRoot = -1; pickSuffix = -1; row = 'roots';
      const head = `<p class="ik-worth">PRACTICE · <b>${worth(state)} points</b></p>
        <div class="ik-lesson"><h5>Read together</h5><p>${escape(lessonText(card))}</p></div>
        <p class="ik-prompt-sub">${escape(card.promptSub)}</p>
        <div class="${promptClass(card)}" lang="${card.kind === 'gloss' || card.kind === 'build' ? 'en' : 'iu'}">${escape(card.prompt)}</div>`;
      let body;
      if (card.kind === 'build') {
        body = `<p class="ik-row-label ik-active" data-row-label="roots"><span>Root</span><span>pick with 1–4</span></p><div class="ik-options" data-group="roots">${card.roots.map((o, i) => optionButton(o, i)).join('')}</div>
          <p class="ik-row-label" data-row-label="suffixes"><span>Suffix</span><span>then 1–4 again</span></p><div class="ik-options" data-group="suffixes">${card.suffixes.map((o, i) => optionButton(o, i)).join('')}</div>`;
      } else body = `<div class="ik-options" data-group="options">${card.options.map((o, i) => optionButton(o, i)).join('')}</div>`;
      find('[data-card]').innerHTML = head + body + `<div class="ik-feedback" data-feedback hidden></div>`;
      if (card.hinted) showHint();
      actions({ hint: !card.hinted, next: card.kind === 'build', nextLabel: 'Commit' });
      if (card.kind === 'build') find('[data-next]').disabled = true;
      find('[data-hint-extra]').textContent = card.kind === 'build' ? 'Enter commits root + suffix' : 'Escape closes the operation';
      litChart(card, false);
      setCursor(0);
      live(`Read together. ${lessonText(card)} ${card.promptSub}: ${card.prompt}. ${card.kind === 'build' ? 'Roots: ' + card.roots.map(o => o.label).join(', ') + '. Suffixes: ' + card.suffixes.map(o => o.label).join(', ') : 'Options: ' + card.options.map((o, i) => `${i + 1} ${o.label}${o.sub ? ' ' + o.sub : ''}`).join(', ')}.`);
    }
    function lessonText(card) {
      if (card.kind === 'spell') return `${card.word.s} · ${card.word.w} · ${card.word.en}. Read it in parts: ${card.tokens.map(t => `${t.glyph} = ${t.roman}${t.final ? ' (final, no vowel)' : ''}`).join(' · ')}. Match the complete word below.`;
      if (card.word) return `${card.word.s} · ${card.word.w} means ${card.word.en}. ${card.word.note}`;
      if (card.place) return `${card.place.name} means ${card.place.en}. ${card.place.parts}.`;
      return card.note;
    }
    function hintText(card) {
      if (card.kind === 'glyph' || card.kind === 'sound') {
        const series = SERIES.find(r => r.c === card.row);
        return card.vi < 0 ? `A final: the small raised form of the ${card.row} row, ${series.glyphs.join(' ')}.`
          : `The ${card.row || 'bare vowel'} row reads ${series.glyphs.join(' ')} for ${VOWELS.map(v => card.row + v).join(', ')}; the syllabary is lit for it.`;
      }
      if (card.kind === 'word' || card.kind === 'gloss') { const d = card.word.d; return `The word belongs to the ${({ ice: 'ice', sea: 'water', land: 'land', sky: 'weather and sky', animal: 'animal', people: 'people', gear: 'gear and travel', phrase: 'greetings and phrases', number: 'number' })[d]} set. ${card.note.split('. ')[0]}.`; }
      if (card.kind === 'spell') { const full = card.tokens.filter(t => !t.final).length, finals = card.tokens.length - full; return `${card.tokens.length} glyphs: ${full} full syllable${full === 1 ? '' : 's'}${finals ? ` and ${finals} small final${finals === 1 ? '' : 's'}` : ''}${card.tokens.some(t => t.long) ? ', one of them with a length dot' : ', no length dots'}. The rows are lit on the syllabary.`; }
      if (card.kind === 'place') return `Parts: ${card.place.parts}.`;
      return `The suffix means "${card.suffixes[card.answerSuffix].sub}"; the root is the word for the thing itself.`;
    }
    function showHint() {
      const box = find('[data-feedback]');
      const card = state.card;
      const guide = card.kind === 'build'
        ? `Choose root ${card.answerRoot + 1} (${card.roots[card.answerRoot].label}), then suffix ${card.answerSuffix + 1} (${card.suffixes[card.answerSuffix].label}).`
        : `Choose ${card.answer + 1}: ${card.options[card.answer].label}.`;
      box.hidden = false; box.className = 'ik-feedback';
      box.textContent = `${guide} ${hintText(card)} Take another look at the example above; all points are still available.`;
      litChart(card, true);
      if (['glyph', 'sound', 'spell'].includes(card.kind)) setChart(true);
    }
    function renderFeedback(result) {
      const card = state.card;
      if (!result.ok) {
        showHint();
        if (card.kind === 'build') { pickRoot = -1; pickSuffix = -1; setRow('roots');
          panel.querySelectorAll('[data-option]').forEach(b => b.classList.remove('ik-picked'));
          find('[data-next]').disabled = true;
        }
        live(`Let’s try that together. ${find('[data-feedback]').textContent}`);
        panel.focus({ preventScroll: true });
        return;
      }
      const buttons = group => [...panel.querySelectorAll(`[data-group="${group}"] [data-option]`)];
      if (card.kind === 'build') {
        buttons('roots').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answerRoot); b.classList.toggle('ik-wrong', i === result.choice.root && i !== card.answerRoot); });
        buttons('suffixes').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answerSuffix); b.classList.toggle('ik-wrong', i === result.choice.suffix && i !== card.answerSuffix); });
      } else buttons('options').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answer); b.classList.toggle('ik-wrong', i === result.choice && i !== card.answer); b.classList.remove('ik-cursor'); });
      const box = find('[data-feedback]');
      box.hidden = false; box.className = `ik-feedback ${result.ok ? 'ik-good' : 'ik-poor'}`;
      const verdict = `<b>You’ve practised it. +${result.points} points.</b>`;
      const note = card.note.replace(/([᐀-ᙿ][᐀-ᙿ ]*)/g, '<span class="ik-syl">$1</span>');
      box.innerHTML = `${verdict} ${note}`;
      litChart(card, true);
      const legIndex = state.leg, k = state.decks[legIndex].findIndex(c => c.prompt === card.prompt && c.kind === card.kind);
      if (k >= 0) outcomes[legIndex][k] = 'ok';
      actions({ next: true, nextLabel: state.queue.length ? 'Next card' : state.leg < 2 ? 'Next leg' : 'Finish' });
      find('[data-next]').focus({ preventScroll: true });
      live(box.textContent);
      renderMeters(); renderLegs(); renderLearned();
    }
    function renderEnd() {
      const s = summary(state);
      const legs = LEGS.map((leg, i) => `<div><dt>${escape(leg.name)}: ${s.legs[i].correct}/${state.decks[i].length}</dt><dd>${s.legs[i].points}</dd></div>`).join('');
      find('[data-card]').innerHTML = `<div class="ik-brief"><p class="ik-brief-kicker">WATCH COMPLETE</p>
        <h4>A first language watch</h4>
        <p>${s.cards} examples explored, with ${s.learned.length} words and names in your log. Come back to practise the shapes or explore more names.</p>
        <dl class="ik-breakdown">${legs}</dl>
        ${submitted ? '<p class="ik-brief-small">Points were banked on the first watch; this one was for the words.</p>' : `<p class="ik-points"><strong>${s.points}</strong> science points</p>`}
        <p class="ik-brief-small">Nakurmiik, qujannamiik, quana: three ways to say thank you, from Nunavik to the Kitikmeot.</p>
        <button type="button" class="ik-go" data-action="replay">New watch <kbd>R</kbd></button></div>`;
      actions({ next: false });
      find('[data-hint-extra]').textContent = 'R deals a new watch';
      renderLegs(); renderMeters();
      if (!submitted) {
        submitted = true;
        try { complete(s.points, { title: `Inuktitut: ${s.cards} examples explored`, ...s, near: state.near?.place.name ?? null }); } catch (error) { console.error(error); }
      }
    }
    // ---------- primer: how the system works ----------
    function turnerHtml() {
      const t = primer.turner, row = TURNER_ROWS[t.ri];
      const vi = t.long ? (t.vi | 1) : (t.vi & ~1);
      const glyph = t.final && row.final ? row.final : row.glyphs[vi];
      const cells = [0, 2, 4].map(k => `<button type="button" data-turn-v="${k}" class="${!t.final && (vi & ~1) === k ? 'ik-on' : ''}" aria-label="${row.c}${VOWELS[k]}"><b class="ik-syl">${row.glyphs[t.long ? k + 1 : k]}</b><small>${row.c}${VOWELS[t.long ? k + 1 : k]}</small></button>`).join('');
      const fin = row.final ? `<button type="button" data-turn-final class="${t.final ? 'ik-on' : ''}" aria-label="final ${row.c}"><b class="ik-syl">${row.final}</b><small>${row.c}</small></button>` : '';
      return `<div class="ik-turner">
        <div class="ik-turner-big"><b class="ik-syl">${glyph}</b><span>${escape(t.final && row.final ? row.c : row.c + VOWELS[vi])}</span></div>
        <div class="ik-turner-controls">
          <div class="ik-turner-row"><button type="button" data-turn-row="-1" aria-label="previous consonant">▲ <kbd>W</kbd></button><span class="ik-turner-name">${row.c ? `the <b>${escape(row.c)}</b> shape` : 'the bare vowel'}</span><button type="button" data-turn-row="1" aria-label="next consonant">▼ <kbd>S</kbd></button></div>
          <div class="ik-turner-cells">${cells}${fin}</div>
          <div class="ik-turner-row"><button type="button" data-turn-long class="${t.long ? 'ik-on' : ''}" aria-pressed="${t.long}">Long vowel: dot <kbd>Space</kbd></button></div>
        </div>
        <p class="ik-turner-text" data-turner-text>${escape(turnerText(row.c, vi, t.final))}</p>
      </div>`;
    }
    function benchHtml() {
      const tokens = syllables(primer.text);
      const out = tokens.filter(t => !t.space);
      return `<div class="ik-bench">
        <label class="ik-bench-input"><span>Roman letters</span><input type="text" data-bench autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" value="${escape(primer.text)}" placeholder="nanuq, tuktu, siku…"></label>
        <div class="ik-bench-out" data-bench-out>
          <div class="ik-bench-word ik-syl" lang="iu">${escape(tokens.map(t => t.glyph).join('')) || '&nbsp;'}</div>
          <ol class="ik-tokens">${out.map(t => `<li class="${t.raw ? 'ik-raw' : t.final ? 'ik-fin' : ''}"><b class="ik-syl">${escape(t.glyph)}</b><span>${escape(describe(t))}</span></li>`).join('') || '<li class="ik-none">Type a word to see it written glyph by glyph.</li>'}</ol>
        </div>
      </div>`;
    }
    function renderPrimer() {
      const page = PAGES[primer.page], n = PAGES.length, box = find('[data-primer]');
      const tabs = PAGES.map((p, i) => `<button type="button" data-page="${i}" class="${i === primer.page ? 'ik-on' : ''}" aria-current="${i === primer.page ? 'page' : 'false'}" aria-label="page ${i + 1}: ${escape(p.title)}">${i + 1}</button>`).join('');
      box.innerHTML = `<div class="ik-brief ik-primer-body">
        <p class="ik-brief-kicker">HOW THE SYSTEM WORKS · ${primer.page + 1} OF ${n}</p>
        <h4>${escape(page.title)}${page.inuk ? `<span class="ik-syl">${page.inuk}</span>` : ''}</h4>
        <p>${escape(page.lead)}</p>
        ${page.demo === 'turner' ? turnerHtml() : page.demo === 'workbench' ? benchHtml() : page.html || ''}
        ${page.body.map(t => `<p>${escape(t)}</p>`).join('')}
        ${page.small ? `<p class="ik-brief-small">${escape(page.small)}</p>` : ''}
        <div class="ik-primer-nav"><div class="ik-pages" role="tablist">${tabs}</div>
          <button type="button" data-page="${primer.page - 1}" ${primer.page === 0 ? 'disabled' : ''}>Back <kbd>←</kbd></button>
          ${primer.page < n - 1 ? `<button type="button" class="ik-next" data-page="${primer.page + 1}">Next <kbd>Enter</kbd></button>` : '<button type="button" class="ik-next" data-action="logic">Back to the watch <kbd>Enter</kbd></button>'}
          <button type="button" data-action="logic" class="ik-quiet">Close <kbd>L</kbd></button></div>
        <p class="ik-hint ik-primer-keys">${escape(page.keys || '←→ or 1–8 pages · Enter next')}</p></div>`;
      live(`How the system works, page ${primer.page + 1} of ${n}: ${page.title}. ${page.lead}`);
    }
    function benchUpdate() {
      const out = find('[data-bench-out]'); if (!out) return;
      const tmp = document.createElement('div'); tmp.innerHTML = benchHtml();
      out.replaceWith(tmp.querySelector('[data-bench-out]'));
    }
    function setPage(i, focus = true) {
      primer.page = Math.max(0, Math.min(PAGES.length - 1, i));
      renderPrimer();
      if (focus) find('[data-primer]').focus({ preventScroll: true });
    }
    function turn(change) {
      const t = primer.turner;
      Object.assign(t, change);
      const rows = TURNER_ROWS.length;
      t.ri = ((t.ri % rows) + rows) % rows;
      t.vi = ((t.vi % 6) + 6) % 6;
      renderPrimer();
      find('[data-primer]').focus({ preventScroll: true });
    }
    function openPrimer(page = primer.page, focus = true) {
      primer.open = true;
      find('[data-primer]').hidden = false; find('[data-card]').hidden = true; find('[data-actions]').hidden = true;
      find('[data-action="logic"]').setAttribute('aria-pressed', 'true');
      setPage(page, focus);
    }
    function closePrimer() {
      if (!primer.open) return;
      primer.open = false;
      find('[data-primer]').hidden = true; find('[data-card]').hidden = false; find('[data-actions]').hidden = false;
      find('[data-action="logic"]').setAttribute('aria-pressed', 'false');
      live('Back to the watch.');
      panel.focus({ preventScroll: true });
    }
    function togglePrimer() { if (primer.open) closePrimer(); else openPrimer(); }
    function openTurnerAt(c, vi) {
      const ri = TURNER_ROWS.findIndex(r => r.c === c);
      if (ri < 0) { if (!primer.open) togglePrimer(); setPage(PAGES.findIndex(p => p.id === 'marks')); return; }
      Object.assign(primer.turner, { ri, vi: vi < 0 ? 4 : vi, long: vi >= 0 && vi % 2 === 1, final: vi < 0 });
      if (!primer.open) openPrimer(TURN_PAGE); else setPage(TURN_PAGE);
    }
    function primerKey(key, event) {
      const page = PAGES[primer.page];
      if (key === 'l' || key === 'Backspace') { event.preventDefault(); closePrimer(); return; }
      if (/^[1-9]$/.test(key) && Number(key) <= PAGES.length) { event.preventDefault(); setPage(Number(key) - 1); return; }
      if (page.demo === 'turner') {
        const t = primer.turner;
        const rowStep = { ArrowUp: -1, w: -1, ArrowDown: 1, s: 1 }[key], vStep = { a: -1, d: 1 }[key];
        if (rowStep !== undefined) { event.preventDefault(); turn({ ri: t.ri + rowStep }); return; }
        if (vStep !== undefined) { event.preventDefault(); turn({ vi: (t.vi & ~1) + 2 * vStep, final: false }); return; }
        if (key === ' ') { event.preventDefault(); turn({ long: !t.long, final: false }); return; }
        if (key === 'f') { event.preventDefault(); turn({ final: !t.final }); return; }
      }
      if (key === 'ArrowRight' || key === ']' || key === 'PageDown') { event.preventDefault(); setPage(primer.page + 1); return; }
      if (key === 'ArrowLeft' || key === '[' || key === 'PageUp') { event.preventDefault(); setPage(primer.page - 1); return; }
      if (key === 'Enter' || key === ' ') { event.preventDefault(); if (primer.page < PAGES.length - 1) setPage(primer.page + 1); else closePrimer(); }
    }

    function render() {
      if (state.phase === 'intro') renderIntro();
      else if (state.phase === 'brief') renderBrief();
      else if (state.phase === 'ask') renderAsk();
      else if (state.phase === 'end') renderEnd();
      renderLegs(); renderMeters();
    }

    // ---------- interaction ----------
    function currentButtons() { return [...panel.querySelectorAll(`[data-group="${state.card?.kind === 'build' ? row : 'options'}"] [data-option]`)]; }
    function setCursor(i) {
      const buttons = currentButtons(); if (!buttons.length) return;
      cursor = (i + buttons.length) % buttons.length;
      panel.querySelectorAll('[data-option]').forEach(b => b.classList.remove('ik-cursor'));
      buttons[cursor].classList.add('ik-cursor');
    }
    function setRow(next) {
      row = next;
      panel.querySelectorAll('[data-row-label]').forEach(p => p.classList.toggle('ik-active', p.dataset.rowLabel === row));
      setCursor(row === 'roots' ? Math.max(0, pickRoot) : Math.max(0, pickSuffix));
    }
    function pick(group, i) {
      if (state.phase !== 'ask') return;
      const card = state.card;
      if (card.kind !== 'build') { if (i < card.options.length) finish(answer(state, i)); return; }
      if (group === 'roots') { pickRoot = i; if (pickSuffix < 0) setRow('suffixes'); }
      else { pickSuffix = i; if (pickRoot < 0) setRow('roots'); }
      panel.querySelectorAll('[data-group="roots"] [data-option]').forEach((b, k) => b.classList.toggle('ik-picked', k === pickRoot));
      panel.querySelectorAll('[data-group="suffixes"] [data-option]').forEach((b, k) => b.classList.toggle('ik-picked', k === pickSuffix));
      const ready = pickRoot >= 0 && pickSuffix >= 0;
      find('[data-next]').disabled = !ready;
      if (ready) live(`${card.roots[pickRoot].label} + ${card.suffixes[pickSuffix].label}. Enter commits.`);
    }
    function commit() {
      if (state.phase !== 'ask' || state.card.kind !== 'build' || pickRoot < 0 || pickSuffix < 0) return;
      finish(answer(state, { root: pickRoot, suffix: pickSuffix }));
    }
    function unpick() {
      if (state.phase !== 'ask' || state.card?.kind !== 'build') return;
      if (row === 'suffixes' && pickSuffix >= 0) pickSuffix = -1; else if (pickRoot >= 0) { pickRoot = -1; setRow('roots'); } else return;
      panel.querySelectorAll('[data-option]').forEach(b => b.classList.remove('ik-picked'));
      panel.querySelectorAll('[data-group="roots"] [data-option]').forEach((b, k) => b.classList.toggle('ik-picked', k === pickRoot));
      panel.querySelectorAll('[data-group="suffixes"] [data-option]').forEach((b, k) => b.classList.toggle('ik-picked', k === pickSuffix));
      find('[data-next]').disabled = true;
    }
    function finish(result) { if (result) renderFeedback(result); }
    function advance() {
      if (state.phase === 'intro') { startLeg(state); render(); return; }
      if (state.phase === 'brief') { draw(state); render(); return; }
      if (state.phase === 'feedback') { draw(state); if (state.phase === 'brief' && state.leg === 1) setChart(false); render(); return; }
      if (state.phase === 'ask') commit();
    }
    function useHint() { if (hint(state)) { showHint(); find('[data-action="hint"]').disabled = true; live(find('[data-feedback]').textContent); } }
    function replay() {
      state = createSession(expedition, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      for (const o of outcomes) for (const k of Object.keys(o)) delete o[k];
      closePrimer();
      setChart(false); renderWhere(); renderLearned(); render();
      panel.focus();
    }

    panel.addEventListener('click', event => {
      const cell = event.target instanceof Element ? event.target.closest('[data-cell]') : null;
      if (cell && alive) { const [c, v] = cell.dataset.cell.split(':'); openTurnerAt(c, v === 'f' ? -1 : Number(v)); return; }
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !alive) return;
      if (button.dataset.page !== undefined) { setPage(Number(button.dataset.page)); return; }
      if (button.dataset.turnRow !== undefined) { turn({ ri: primer.turner.ri + Number(button.dataset.turnRow) }); return; }
      if (button.dataset.turnV !== undefined) { turn({ vi: Number(button.dataset.turnV), final: false }); return; }
      if (button.dataset.turnLong !== undefined) { turn({ long: !primer.turner.long, final: false }); return; }
      if (button.dataset.turnFinal !== undefined) { turn({ final: !primer.turner.final }); return; }
      if (button.dataset.action === 'logic') { togglePrimer(); return; }
      if (primer.open) return;
      if (button.dataset.option !== undefined) { const group = button.closest('[data-group]')?.dataset.group || 'options'; if (state.card?.kind === 'build') setRow(group); pick(group, Number(button.dataset.option)); return; }
      const action = button.dataset.action;
      if (action === 'next') advance();
      else if (action === 'hint') useHint();
      else if (action === 'chart') setChart(!chartOpen);
      else if (action === 'replay') replay();
    }, { signal });
    panel.addEventListener('input', event => {
      if (event.target instanceof HTMLInputElement && event.target.dataset.bench !== undefined) { primer.text = event.target.value; benchUpdate(); }
    }, { signal });
    window.addEventListener('keydown', event => {
      if (!alive || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' || /^(input|textarea|select)$/i.test(event.target?.tagName || '')) return;
      const onButton = event.target instanceof Element && panel.contains(event.target) && event.target.closest('button');
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const confirm = key === 'Enter' || key === ' ';
      if (confirm && onButton && [...onButton.attributes].some(a => /^data-(option|action|page|turn)/.test(a.name))) return; // the button's own click handles it
      if (key === 'c') { event.preventDefault(); setChart(!chartOpen); return; }
      if (key === 'l') { event.preventDefault(); togglePrimer(); return; }
      if (primer.open) { primerKey(key, event); return; }
      if (state.phase === 'end') { if (confirm || key === 'r') { event.preventDefault(); replay(); } return; }
      if (state.phase === 'intro' || state.phase === 'brief' || state.phase === 'feedback') { if (confirm) { event.preventDefault(); advance(); } return; }
      if (state.phase !== 'ask') return;
      if (key === 'h') { event.preventDefault(); useHint(); return; }
      if (/^[1-4]$/.test(key)) { event.preventDefault(); pick(state.card.kind === 'build' ? row : 'options', Number(key) - 1); return; }
      if (key === 'Backspace') { event.preventDefault(); unpick(); return; }
      if (confirm) { event.preventDefault(); if (state.card.kind === 'build') commit(); else pick('options', cursor); return; }
      const step = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1 }[key];
      const jump = { ArrowUp: -1, w: -1, ArrowDown: 1, s: 1 }[key];
      if (step !== undefined) { event.preventDefault(); setCursor(cursor + step); return; }
      if (jump !== undefined) {
        event.preventDefault();
        if (state.card.kind === 'build') setRow(jump > 0 ? 'suffixes' : 'roots'); else setCursor(cursor + jump * 2);
      }
    }, { signal });

    renderWhere(); renderChartTable(); renderLearned(); render();
    return () => { alive = false; events.abort(); root.innerHTML = ''; };
  },
};
