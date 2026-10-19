const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('domliAdminToken') || '';
let accounts = [];

async function api(path, options = {}) {
  const res = await fetch(`/admin/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Er ging iets mis');
  return body;
}

function say(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.className = isError ? 'error' : '';
}

const current = () => accounts.find(a => a.id === $('account').value);

async function loadDocs() {
  const { docs } = await api(`/accounts/${$('account').value}/docs`);
  const list = $('docs');
  list.replaceChildren();
  if (!docs.length) say('Nog geen kennis toegevoegd.');
  for (const doc of docs) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = doc.title;
    const meta = document.createElement('small');
    meta.textContent = `${doc.url || 'Tekst'} · ${doc.chars ?? ''} tekens`;
    info.append(title, meta);
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Verwijderen';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`"${doc.title}" verwijderen?`)) return;
      await api(`/accounts/${$('account').value}/docs/${doc.id}`, { method: 'DELETE' });
      loadDocs();
    });
    li.append(info, remove);
    list.append(li);
  }
}

function showAccount() {
  const account = current();
  $('enabled').checked = account.enabled;
  $('mode').value = account.mode;
  $('instructions').value = account.instructions || '';
  say('');
  return loadDocs();
}

async function start() {
  ({ accounts } = await api('/accounts'));
  $('login').hidden = true;
  $('app').hidden = false;
  $('account').replaceChildren(
    ...accounts.map(a => Object.assign(document.createElement('option'), { value: a.id, textContent: `${a.businessName} (#${a.id})` }))
  );
  await showAccount();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  token = $('token').value;
  try {
    await start();
    sessionStorage.setItem('domliAdminToken', token);
  } catch {
    token = '';
    alert('Onjuist token');
  }
});

$('account').addEventListener('change', showAccount);

async function savePatch(patch) {
  try {
    await api(`/accounts/${$('account').value}`, { method: 'PATCH', body: JSON.stringify(patch) });
    Object.assign(current(), patch);
    say('Opgeslagen.');
  } catch (error) {
    say(error.message, true);
  }
}
$('enabled').addEventListener('change', () => savePatch({ enabled: $('enabled').checked }));
$('mode').addEventListener('change', () => savePatch({ mode: $('mode').value }));

$('instructions-form').addEventListener('submit', event => {
  event.preventDefault();
  savePatch({ instructions: $('instructions').value });
});

$('text-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await api(`/accounts/${$('account').value}/docs`, { method: 'POST', body: JSON.stringify({ title: $('title').value, text: $('text').value }) });
    event.target.reset();
    await loadDocs();
    say('Opgeslagen.');
  } catch (error) {
    say(error.message, true);
  }
});

$('url-form').addEventListener('submit', async event => {
  event.preventDefault();
  say('Pagina wordt opgehaald...');
  try {
    await api(`/accounts/${$('account').value}/docs/url`, { method: 'POST', body: JSON.stringify({ url: $('url').value }) });
    event.target.reset();
    await loadDocs();
    say('Pagina geïmporteerd.');
  } catch (error) {
    say(error.message, true);
  }
});

if (token) start().catch(() => sessionStorage.removeItem('domliAdminToken'));
