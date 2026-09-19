// Inuktitut: a three-leg language watch. Syllabics first (name the sound, find the glyph), then a working
// vocabulary for ice, sea, weather, animals, gear and greetings, then the chart: place names decoded into
// their parts and new words built from a root and a suffix. Missed cards come back once for half points.
import { LEGS, createSession, startLeg, draw, answer, hint, worth, summary, accuracyLabel } from './crew-22-model.js';
import { SERIES, VOWELS } from './crew-22-lexicon.js';

const stylesheet = new URL('./crew-22.css', import.meta.url).href;
const escape = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const KEYS = ['1', '2', '3', '4'];

export const game = {
  title: 'Inuktitut',
  mount(root, { complete, expedition }) {
    const events = new AbortController();
    const { signal } = events;
    let state = createSession(expedition, Date.now() >>> 0);
    let alive = true, submitted = false, cursor = 0, chartOpen = false;
    // Build cards take two picks; `pickRoot`/`pickSuffix` hold them and `row` says which row the keys address.
    let pickRoot = -1, pickSuffix = -1, row = 'roots';
    root.innerHTML = `<section class="ik-game" tabindex="-1" aria-label="Inuktitut">
      <link rel="stylesheet" href="${stylesheet}">
      <div class="ik-heading">
        <div><p class="ik-kicker" data-where></p><h3>Inuktitut<span class="ik-syl">ᐃᓄᒃᑎᑐᑦ</span></h3><p class="ik-sub">Three legs of a language watch: the writing, the words, the names on the chart.</p></div>
        <div class="ik-meters">
          <div class="ik-meter"><strong data-points>0</strong><span>points</span></div>
          <div class="ik-meter"><strong data-streak>0</strong><span>streak</span></div>
          <div class="ik-meter"><strong data-leg>–</strong><span>leg</span></div>
        </div>
      </div>
      <div class="ik-legs" data-legs></div>
      <div class="ik-layout">
        <div class="ik-stage">
          <div class="ik-card" data-card></div>
          <div class="ik-actions">
            <button type="button" data-action="hint">Hint <kbd>H</kbd></button>
            <button type="button" data-action="chart" aria-pressed="false">Syllabary <kbd>C</kbd></button>
            <button type="button" data-action="next" data-next class="ik-next">Next <kbd>Enter</kbd></button>
          </div>
        </div>
        <aside class="ik-side">
          <div class="ik-panel ik-chart" data-chart hidden><h5>Syllabary <span>row: consonant · column: vowel</span></h5><div data-chart-table></div></div>
          <div class="ik-panel"><h5>Learned this watch <span data-learned-count></span></h5><ol class="ik-learned" data-learned aria-label="Words learned"></ol></div>
        </aside>
      </div>
      <p class="ik-live" role="status" aria-live="polite" data-live></p>
      <p class="ik-hint"><kbd>1</kbd>–<kbd>4</kbd> pick · <kbd>←→↑↓</kbd>/<kbd>WASD</kbd> move · <kbd>Enter</kbd>/<kbd>Space</kbd> commit or next · <kbd>H</kbd> hint (half points) · <kbd>C</kbd> syllabary · <kbd>Backspace</kbd> unpick · <span data-hint-extra></span></p>
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
      const rows = SERIES.map(r => `<tr data-row="${r.c}"><th>${r.c || '·'}</th>${r.glyphs.map((g, i) => `<td class="ik-syl" data-cell="${r.c}:${i}">${g}</td>`).join('')}<td class="ik-syl ik-final" data-cell="${r.c}:f">${r.final}</td></tr>`).join('');
      find('[data-chart-table]').innerHTML = `<table>${head}${rows}</table>`;
    }
    function litChart(card, hit) {
      panel.querySelectorAll('[data-cell]').forEach(td => td.classList.remove('ik-lit', 'ik-hit'));
      panel.querySelectorAll('[data-row]').forEach(tr => tr.classList.remove('ik-lit-row'));
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
    // Per-card result dots. `outcomes[leg][k]` is 'ok', 'half' (right on the retry) or 'bad'.
    const outcomes = [{}, {}, {}];
    const dotClass = (leg, k) => ({ ok: 'ik-ok', half: 'ik-half', bad: 'ik-bad' }[outcomes[leg][k]] || '');
    function renderMeters() {
      find('[data-points]').textContent = String(state.score);
      find('[data-streak]').textContent = String(state.streak);
    }
    function renderLearned() {
      const list = find('[data-learned]');
      list.innerHTML = state.learned.length ? state.learned.map(l => `<li><span class="ik-syl">${escape(l.s)}</span><span><b>${escape(l.w)}</b> <small>${escape(l.en)}</small></span></li>`).join('') : '<li class="ik-none">Answer a word card and it lands here.</li>';
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
        <p>Welcome aboard. Inuktitut is spoken from Greenland to the Bering Strait in a chain of dialects; the coast the ship works speaks it every day, and its charts carry a thousand years of place names. The Nunavut standard writes it in syllabics: shapes for consonants, turned for vowels.</p>
        <p>Three legs, eight cards each. A card missed comes back once for half its points; a hint halves them too. Every fifth card in a row is a 10-point bonus.</p>
        <p class="ik-brief-small">Pronunciation: q is a k made far back in the throat; doubled letters are held long; ng as in singer. Spellings follow the Inuit Cultural Institute standard used in Nunavut; Inuinnaqtun and Inuvialuktun to the west are written in Roman letters, and Nunavik forms differ a little.</p>
        <button type="button" class="ik-go" data-action="next">Begin the watch <kbd>Enter</kbd></button></div>`;
      actions({ next: true, nextLabel: 'Begin' });
      find('[data-hint-extra]').textContent = 'Escape closes the operation';
    }
    function renderBrief() {
      const leg = LEGS[state.leg];
      find('[data-card]').innerHTML = `<div class="ik-brief"><p class="ik-brief-kicker">LEG ${state.leg + 1} OF 3 · ${escape(leg.points)} POINTS A CARD</p>
        <h4>${escape(leg.name)}<span class="ik-syl">${leg.inuk}</span> <small style="font:14px system-ui,sans-serif;color:#b9d0d6">${escape(leg.roman)}</small></h4>
        <p>${escape(leg.brief)}</p>
        ${state.leg === 2 && state.near ? `<p class="ik-brief-small">The first name is the nearest community to the ship: ${escape(state.near.place.name)}, ${Math.round(state.near.km)} km away.</p>` : ''}
        <button type="button" class="ik-go" data-action="next">Deal the cards <kbd>Enter</kbd></button></div>`;
      actions({ next: true, nextLabel: 'Deal' });
      if (state.leg === 0) setChart(true);
    }
    function optionButton(option, i, extra = '') {
      const syl = option.label && /[᐀-ᙿ]/.test(option.label);
      const big = syl && option.label.length <= 2;
      return `<button type="button" data-option="${i}" ${extra} aria-label="${escape(option.label)}${option.sub ? `, ${escape(option.sub)}` : ''}">
        <span class="ik-key">${KEYS[i]}</span><span class="ik-opt"><b class="${syl ? 'ik-syl' : ''} ${big ? 'ik-big' : ''}">${escape(option.label)}</b>${option.sub ? `<small>${escape(option.sub)}${option.gloss ? ` · ${escape(option.gloss)}` : ''}</small>` : option.gloss ? `<small>${escape(option.gloss)}</small>` : ''}</span></button>`;
    }
    function promptClass(card) {
      if (card.kind === 'gloss' || card.kind === 'build') return 'ik-prompt ik-en';
      if (card.kind === 'sound' || card.roman) return 'ik-prompt ik-roman';
      return 'ik-prompt ik-syl';
    }
    function renderAsk() {
      const card = state.card;
      cursor = 0; pickRoot = -1; pickSuffix = -1; row = 'roots';
      const head = `<p class="ik-worth">${card.retry ? 'SECOND LOOK · ' : ''}${card.hinted ? 'HINTED · ' : ''}worth <b>${worth(state)}</b></p>
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
      live(`${card.promptSub}: ${card.prompt}. ${card.kind === 'build' ? 'Roots: ' + card.roots.map(o => o.label).join(', ') + '. Suffixes: ' + card.suffixes.map(o => o.label).join(', ') : 'Options: ' + card.options.map((o, i) => `${i + 1} ${o.label}${o.sub ? ' ' + o.sub : ''}`).join(', ')}.`);
    }
    function hintText(card) {
      if (card.kind === 'glyph' || card.kind === 'sound') {
        const series = SERIES.find(r => r.c === card.row);
        return card.vi < 0 ? `A final: the small raised form of the ${card.row} row, ${series.glyphs.join(' ')}.`
          : `The ${card.row || 'bare vowel'} row reads ${series.glyphs.join(' ')} for ${VOWELS.map(v => card.row + v).join(', ')}; the syllabary is lit for it.`;
      }
      if (card.kind === 'word' || card.kind === 'gloss') { const d = card.word.d; return `The word belongs to the ${({ ice: 'ice', sea: 'water', land: 'land', sky: 'weather and sky', animal: 'animal', people: 'people', gear: 'gear and travel', phrase: 'greetings and phrases', number: 'number' })[d]} set. ${card.note.split('. ')[0]}.`; }
      if (card.kind === 'place') return `Parts: ${card.place.parts}.`;
      return `The suffix means "${card.suffixes[card.answerSuffix].sub}"; the root is the word for the thing itself.`;
    }
    function showHint() {
      const box = find('[data-feedback]');
      box.hidden = false; box.className = 'ik-feedback'; box.innerHTML = `<b>Hint.</b> ${escape(hintText(state.card))}`;
      litChart(state.card, false); if (state.card.kind === 'glyph' || state.card.kind === 'sound') setChart(true);
      find('.ik-worth').innerHTML = `${state.card.retry ? 'SECOND LOOK · ' : ''}HINTED · worth <b>${worth(state)}</b>`;
    }
    function renderFeedback(result) {
      const card = state.card;
      const buttons = group => [...panel.querySelectorAll(`[data-group="${group}"] [data-option]`)];
      if (card.kind === 'build') {
        buttons('roots').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answerRoot); b.classList.toggle('ik-wrong', i === result.choice.root && i !== card.answerRoot); });
        buttons('suffixes').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answerSuffix); b.classList.toggle('ik-wrong', i === result.choice.suffix && i !== card.answerSuffix); });
      } else buttons('options').forEach((b, i) => { b.disabled = true; b.classList.toggle('ik-right', i === card.answer); b.classList.toggle('ik-wrong', i === result.choice && i !== card.answer); b.classList.remove('ik-cursor'); });
      const box = find('[data-feedback]');
      box.hidden = false; box.className = `ik-feedback ${result.ok ? 'ik-good' : 'ik-poor'}`;
      const verdict = result.ok ? `<b>${['Ii.', 'Yes.', 'Right.'][result.points % 3]} +${result.points}${result.bonus ? ` and a streak bonus of ${result.bonus}` : ''}.</b>`
        : `<b>Aakka.</b> ${card.retry ? 'That one stays in the log to look up later.' : 'It comes back at the end of the leg for half points.'}`;
      const note = card.note.replace(/([᐀-ᙿ][᐀-ᙿ ]*)/g, '<span class="ik-syl">$1</span>');
      box.innerHTML = `${verdict} ${note}`;
      litChart(card, true);
      const legIndex = state.leg, k = state.decks[legIndex].findIndex(c => c.prompt === card.prompt && c.kind === card.kind);
      if (k >= 0 && (result.ok || card.retry)) outcomes[legIndex][k] = result.ok ? (card.retry ? 'half' : 'ok') : 'bad';
      actions({ next: true, nextLabel: state.queue.length ? 'Next card' : state.leg < 2 ? 'Next leg' : 'Finish' });
      find('[data-next]').focus({ preventScroll: true });
      live(`${result.ok ? 'Correct' : 'Wrong'}. ${box.textContent}`);
      renderMeters(); renderLegs(); renderLearned();
    }
    function renderEnd() {
      const s = summary(state);
      const legs = LEGS.map((leg, i) => `<div><dt>${escape(leg.name)}: ${s.legs[i].correct}/${state.decks[i].length}</dt><dd>${s.legs[i].points}</dd></div>`).join('');
      find('[data-card]').innerHTML = `<div class="ik-brief"><p class="ik-brief-kicker">WATCH COMPLETE</p>
        <h4>${escape(accuracyLabel(s.firstTry, s.cards))}</h4>
        <p>${s.firstTry} of ${s.cards} cards right first time, ${s.correct} of ${s.asked} answers in all. Best streak ${s.bestStreak}${s.hints ? `, ${s.hints} hint${s.hints === 1 ? '' : 's'}` : ''}.</p>
        <dl class="ik-breakdown">${legs}</dl>
        ${submitted ? '<p class="ik-brief-small">Points were banked on the first watch; this one was for the words.</p>' : `<p class="ik-points"><strong>${s.points}</strong> science points</p>`}
        <p class="ik-brief-small">Nakurmiik, qujannamiik, quana: three ways to say thank you, from Nunavik to the Kitikmeot.</p>
        <button type="button" class="ik-go" data-action="replay">New watch <kbd>R</kbd></button></div>`;
      actions({ next: false });
      find('[data-hint-extra]').textContent = 'R deals a new watch';
      renderLegs(); renderMeters();
      if (!submitted) {
        submitted = true;
        try { complete(s.points, { title: `Inuktitut watch: ${s.firstTry}/${s.cards} first time`, ...s, near: state.near?.place.name ?? null }); } catch (error) { console.error(error); }
      }
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
    function useHint() { if (hint(state)) { showHint(); find('[data-action="hint"]').disabled = true; live(hintText(state.card)); } }
    function replay() {
      state = createSession(expedition, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
      for (const o of outcomes) for (const k of Object.keys(o)) delete o[k];
      setChart(false); renderWhere(); renderLearned(); render();
      panel.focus();
    }

    panel.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !alive) return;
      if (button.dataset.option !== undefined) { const group = button.closest('[data-group]')?.dataset.group || 'options'; if (state.card?.kind === 'build') setRow(group); pick(group, Number(button.dataset.option)); return; }
      const action = button.dataset.action;
      if (action === 'next') advance();
      else if (action === 'hint') useHint();
      else if (action === 'chart') setChart(!chartOpen);
      else if (action === 'replay') replay();
    }, { signal });
    window.addEventListener('keydown', event => {
      if (!alive || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape' || /^(input|textarea|select)$/i.test(event.target?.tagName || '')) return;
      const onButton = event.target instanceof Element && panel.contains(event.target) && event.target.closest('button');
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const confirm = key === 'Enter' || key === ' ';
      if (confirm && onButton && (onButton.dataset.option !== undefined || onButton.dataset.action)) return; // the button's own click handles it
      if (key === 'c') { event.preventDefault(); setChart(!chartOpen); return; }
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
