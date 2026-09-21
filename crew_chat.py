"""Table conversation through the ship's resident chat model, using public play only."""
import json
from pathlib import Path
import urllib.request

PERSONAS = json.loads((Path(__file__).parent / 'crew-personas.json').read_text())
CONFIG = Path.home() / '.config/underway/chat-model.json'
UNDERWAY = Path(__file__).parent / 'static/data/crew-15-neptune.json'
ARCHIVE = Path(__file__).parent / 'static/data/crew-18-wrecks.json'
HEARTS_VOICES = {
    'capn': 'Direct, dry, and mildly competitive.',
    'doc': 'Warm, observant, and easygoing.',
    'ada': 'Dry, concise, and perceptive.',
    'polly': 'Brief, cheeky, and playful.',
}


def fetch(url, body=None, timeout=5):
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def table_fact(hand):
    snapshot = json.loads(UNDERWAY.read_text())
    archive = json.loads(ARCHIVE.read_text())
    wreck = archive['wrecks'][(hand - 1) % len(archive['wrecks'])]
    facts = [
        f"The local underway record for this leg logs {snapshot['distanceKm']:.0f} km over {snapshot['hours']:.0f} hours.",
        f"Its highest logged wind was {snapshot['extremes']['windMax']['value']:.0f} kn.",
        f"The coldest logged air temperature was {snapshot['extremes']['airMin']['value']:.1f}°C.",
        f"The onboard Arctic history archive records that {wreck['ship']} was lost near {wreck['place']} in {wreck['year']}.",
    ]
    return facts[(hand - 1) % len(facts)]


def reply(handle, context):
    config = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    backend = config.get('api', 'ollama')
    url = config.get('url', 'http://127.0.0.1:11434').rstrip('/')
    model = config.get('model', 'gemma4-local')
    # Read the resident model inventory; conversation must not load a model onto the shared GPU.
    inventory = fetch(url + ('/v1/models' if backend == 'openai' else '/api/ps'))
    names = [item.get('id', item.get('name', '')) for item in inventory.get('data', inventory.get('models', []))]
    if not any(name == model or name.split(':')[0] == model.split(':')[0] for name in names):
        raise RuntimeError('The crew conversation model is not available.')
    persona = PERSONAS[handle]
    aside = bool(context.get('aside'))
    if aside and context.get('conversationTurn') == 1:
        task = "Make a specific observation about a visible card, the score, or how this hand differs from an earlier hand. You may ask another player a natural question."
    elif aside:
        task = "Reply directly to replyTo and add one new observation. Do not merely agree or restate it."
    else:
        task = "Answer the human's latest message directly, in their language."
    system = (f"You are {persona['name']}, a coworker playing Hearts aboard CCGS Amundsen. "
              f"Your conversational style is: {HEARTS_VOICES[handle]} "
              "Talk like a normal person at a casual card table. Use one short sentence, occasionally two. "
              "Do not force nautical or scientific metaphors. Do not repeat, paraphrase, or praise the previous remark. "
              "Never say what card you will play, because the game engine plays your cards separately. "
              "Comment only on public information, and do not invent cards, measurements, sources, or events. " +
              task + " Be specific; never use generic filler such as 'you're in', 'nice', or 'interesting'. "
              "In Hearts, every heart is one point; only Q♠ is thirteen. A♥, K♥, Q♥, and J♥ are not special beyond being hearts. "
              "Cards appear as 5♠ or A♥; never use internal IDs such as S5. Do not output headings, lists, tables, plans, or tool chatter.")
    if aside and context.get('factRequested') and context.get('conversationTurn') == 1:
        context = {**context, 'underwayFact': table_fact(context['hand'])}
    messages = [{'role': 'system', 'content': system}, {'role': 'user', 'content': json.dumps(context, ensure_ascii=False)}]
    if backend == 'openai':
        body = dict(model=model, messages=messages, stream=False, max_tokens=100,
                    temperature=0.65, chat_template_kwargs={'enable_thinking': False})
        result = fetch(url + '/v1/chat/completions', body, timeout=90)
        text = result['choices'][0]['message'].get('content', '')
    elif backend == 'ollama':
        body = dict(model=model, messages=messages, stream=False, think=False, keep_alive=-1,
                    options={'num_predict': 100, 'num_ctx': 8192, 'temperature': 0.65})
        text = fetch(url + '/api/chat', body, timeout=90).get('message', {}).get('content', '')
    else:
        raise RuntimeError('The crew conversation backend is unavailable.')
    text = text.strip()
    if not text:
        raise RuntimeError('The crew did not finish their reply. Try again.')
    return text[:1600]
