const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({limit: '1mb'}));

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';
const ONE_SIGNAL_API_URL =
  process.env.ONESIGNAL_CREATE_MESSAGE_URL ||
  'https://onesignal.com/api/v1/notifications';
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'swap-e9630';
const FIREBASE_PUBLIC_API_KEY =
  process.env.FIREBASE_PUBLIC_API_KEY ||
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.FIREBASE_API_KEY ||
  'AIzaSyCFfTBwF-HXWATxcknSaxguozhsxzNLYJA';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://freeobmin.pp.ua',
  'https://www.freeobmin.pp.ua',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8888',
];

const ADMIN_ALLOWED_ORIGINS = parseList(process.env.ADMIN_ALLOWED_ORIGINS);

const PUSH_TEMPLATES = [
  {
    id: 'custom',
    name: 'Custom message',
    description: 'Compose a message manually and route it anywhere in the app.',
    defaults: {
      title: '',
      body: '',
      screen: 'home',
    },
  },
  {
    id: 'category_update',
    name: 'Category update',
    description: 'Send users to a category feed after the tap.',
    defaults: {
      title: 'New listings in this category',
      body: 'Tap to open the latest listings.',
      screen: 'category',
      category: 'clothes',
    },
  },
  {
    id: 'item_spotlight',
    name: 'Item spotlight',
    description: 'Open a specific listing directly from the push.',
    defaults: {
      title: 'New listing',
      body: 'Tap to view the listing details.',
      screen: 'item',
    },
  },
  {
    id: 'chat_nudge',
    name: 'Chat reminder',
    description: 'Bring the user back into a specific chat thread.',
    defaults: {
      title: 'New message',
      body: 'Open the chat to continue the conversation.',
      screen: 'chat',
    },
  },
];

const APP_CATEGORIES = [
  {slug: 'electronics', label: 'Electronics'},
  {slug: 'phones', label: 'Phones and gadgets'},
  {slug: 'computers', label: 'Computers and office'},
  {slug: 'clothes', label: 'Clothes and shoes'},
  {slug: 'kids', label: 'Kids'},
  {slug: 'home', label: 'Home'},
  {slug: 'furniture', label: 'Furniture'},
  {slug: 'kitchen', label: 'Kitchen'},
  {slug: 'books', label: 'Books'},
  {slug: 'sport', label: 'Sport'},
  {slug: 'hobby', label: 'Hobby'},
  {slug: 'beauty', label: 'Beauty'},
  {slug: 'pets', label: 'Pets'},
  {slug: 'auto', label: 'Auto'},
  {slug: 'garden', label: 'Garden'},
  {slug: 'tools', label: 'Tools'},
  {slug: 'games', label: 'Games'},
  {slug: 'other', label: 'Other'},
];

const CATEGORY_ALIASES = {
  clothes: 'clothes',
  clothing: 'clothes',
  odezhda: 'clothes',
  odyag: 'clothes',
  odiah: 'clothes',
  shoes: 'clothes',
  electronics: 'electronics',
  technics: 'electronics',
  phones: 'phones',
  gadgets: 'phones',
  computers: 'computers',
  kids: 'kids',
  home: 'home',
  house: 'home',
  furniture: 'furniture',
  kitchen: 'kitchen',
  books: 'books',
  sport: 'sport',
  hobby: 'hobby',
  beauty: 'beauty',
  pets: 'pets',
  auto: 'auto',
  garden: 'garden',
  tools: 'tools',
  games: 'games',
  other: 'other',
};

const PUSH_ROUTE_SCREENS = ['home', 'category', 'item', 'chat', 'notifications'];
const PUSH_AUDIENCE_MODES = ['subscribed', 'tag', 'external_ids'];
const PUSH_HISTORY_COLLECTION = 'admin_push_logs';

let firestore = null;
let firebaseInitError = '';

try {
  const serviceAccount = loadServiceAccountFromEnv();
  if (!admin.apps.length) {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId:
          serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID || undefined,
      });
    } else {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || undefined,
      });
    }
  }
  firestore = admin.firestore();
} catch (error) {
  firebaseInitError = String(error);
  console.warn('Firebase Admin init failed:', error);
}

app.use((req, res, next) => {
  const origin = getAllowedOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    firebaseReady: Boolean(firestore),
    firebaseRestReady: Boolean(FIREBASE_PROJECT_ID && FIREBASE_PUBLIC_API_KEY),
    firebaseInitError: firebaseInitError || null,
  });
});

app.post('/notify', async (req, res) => {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    return res.status(500).json({error: 'Missing OneSignal config'});
  }

  const {to, title, body, url, appUrl, data, type, senderName} = req.body || {};
  if (!to || !title || !body) {
    return res.status(400).json({error: 'to, title, body required'});
  }

  const formatted = formatNotification({
    title,
    body,
    type,
    senderName,
  });

  const payload = {
    app_id: ONE_SIGNAL_APP_ID,
    include_subscription_ids: [to],
    headings: {en: formatted.title},
    contents: {en: formatted.body},
  };

  if (isPlainObject(data) && Object.keys(data).length > 0) {
    payload.data = data;
  }

  const launchTarget = normalizeText(appUrl || url);
  if (launchTarget) {
    payload.app_url = launchTarget;
  }

  try {
    const response = await sendOneSignalRequest(payload);
    return res.json({ok: true, response});
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || String(error),
      response: error.responseBody || null,
    });
  }
});

app.get('/api/push/templates', requireAdmin, (_req, res) => {
  return res.json({
    ok: true,
    templates: PUSH_TEMPLATES,
    categories: APP_CATEGORIES,
    routeScreens: PUSH_ROUTE_SCREENS,
    audienceModes: PUSH_AUDIENCE_MODES,
  });
});

app.get('/api/push/history', requireAdmin, async (req, res) => {
  const limit = clampInteger(req.query.limit, 20, 1, 50);

  try {
    const items = await readPushHistory(limit, req.adminToken);
    return res.json({ok: true, items});
  } catch (error) {
    return res.status(500).json({error: String(error)});
  }
});

app.post('/api/push/send', requireAdmin, async (req, res) => {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    return res.status(500).json({error: 'Missing OneSignal config'});
  }

  try {
    const input = req.body || {};
    const template = resolveTemplate(input.templateId);
    const title = normalizeText(input.title || template.defaults.title);
    const body = normalizeText(input.body || template.defaults.body);
    if (!title || !body) {
      return res.status(400).json({error: 'title and body are required'});
    }

    const route = buildAdminPushRoute({
      ...template.defaults,
      ...(isPlainObject(input.route) ? input.route : {}),
      screen: normalizeText(input.screen || input.route?.screen || template.defaults.screen),
      category: input.category || input.route?.category || template.defaults.category,
      itemId: input.itemId || input.route?.itemId,
      chatId: input.chatId || input.route?.chatId,
    });

    const audience = buildAudienceTargeting(input.audience);
    const payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: {en: title},
      contents: {en: body},
      data: route.data,
      ...audience.targeting,
    };

    const response = await sendOneSignalRequest(payload);
    const oneSignalMeta = pickOneSignalMeta(response);

    await savePushHistory(
      {
      title,
      body,
      templateId: template.id,
      audience: audience.summary,
      route: route.summary,
      sentBy: {
        uid: req.adminUser.uid,
        email: req.adminUser.email || '',
      },
      oneSignal: oneSignalMeta,
      },
      req.adminToken
    );

    return res.json({
      ok: true,
      template: template.id,
      audience: audience.summary,
      route: route.summary,
      oneSignal: oneSignalMeta,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: error.message || String(error),
      response: error.responseBody || null,
    });
  }
});

app.post('/media/delete', async (req, res) => {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({error: 'Missing Cloudinary config'});
  }

  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (urls.length === 0) {
    return res.status(400).json({error: 'urls[] required'});
  }

  const publicIds = [...new Set(urls.map(extractCloudinaryPublicId).filter(Boolean))];
  if (publicIds.length === 0) {
    return res.json({ok: true, deleted: 0, skipped: urls.length});
  }

  const deleted = [];
  const failed = [];

  for (const publicId of publicIds) {
    try {
      const result = await destroyCloudinaryAsset(publicId);
      deleted.push({publicId, result});
    } catch (error) {
      failed.push({publicId, error: String(error)});
    }
  }

  if (failed.length > 0) {
    return res.status(207).json({
      ok: failed.length < publicIds.length,
      deletedCount: deleted.length,
      failedCount: failed.length,
      deleted,
      failed,
    });
  }

  return res.json({
    ok: true,
    deletedCount: deleted.length,
    deleted,
  });
});

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/[\r\n,]+/)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function loadServiceAccountFromEnv() {
  const rawJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    '';
  if (rawJson.trim()) {
    const parsed = JSON.parse(rawJson);
    if (parsed.private_key) {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '');
  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return null;
}

function getAllowedOrigin(origin) {
  if (!origin) return '';
  const allowed = ADMIN_ALLOWED_ORIGINS.length
    ? ADMIN_ALLOWED_ORIGINS
    : DEFAULT_ALLOWED_ORIGINS;
  if (allowed.includes('*')) return origin;
  return allowed.includes(origin) ? origin : '';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, maxLength = 140) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function looksFormatted(body) {
  return /^Р’С–Рґ:\s/i.test(String(body || '')) || String(body || '').includes('\n');
}

function formatChatBody(body, senderName) {
  if (looksFormatted(body)) return body;
  const sender = normalizeText(senderName) || 'РєРѕСЂРёСЃС‚СѓРІР°С‡Р°';
  const message = truncateText(
    body || 'Р’С–РґРєСЂРёР№ С‡Р°С‚, С‰РѕР± РїСЂРѕС‡РёС‚Р°С‚Рё РїРѕРІС–РґРѕРјР»РµРЅРЅСЏ.'
  );
  return `Р’С–Рґ: ${sender}\n${message}`;
}

function formatSystemBody(body, senderName) {
  if (looksFormatted(body)) return body;
  const sender = normalizeText(senderName) || 'РєРѕРјР°РЅРґРё FreeObmin';
  const message = truncateText(body || 'РќРѕРІРµ СЃРёСЃС‚РµРјРЅРµ РїРѕРІС–РґРѕРјР»РµРЅРЅСЏ');
  return `Р’С–Рґ: ${sender}\n${message}`;
}

function formatNotification({title, body, type, senderName}) {
  const normalizedTitle = normalizeText(title);
  const normalizedBody = String(body || '');
  const kind = normalizeText(type).toLowerCase();

  if (kind === 'chat' || normalizedTitle.toLowerCase().includes('РїРѕРІС–РґРѕРј')) {
    return {
      title: normalizedTitle || 'РќРѕРІРµ РїРѕРІС–РґРѕРјР»РµРЅРЅСЏ',
      body: formatChatBody(normalizedBody, senderName),
    };
  }

  return {
    title: normalizedTitle || 'РЎРїРѕРІС–С‰РµРЅРЅСЏ',
    body: formatSystemBody(normalizedBody, senderName),
  };
}

function resolveTemplate(templateId) {
  const normalized = normalizeText(templateId).toLowerCase();
  return (
    PUSH_TEMPLATES.find((template) => template.id === normalized) ||
    PUSH_TEMPLATES[0]
  );
}

function normalizeCategorySlug(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  const bySlug = APP_CATEGORIES.find((entry) => entry.slug === normalized);
  if (bySlug) return bySlug.slug;
  const byLabel = APP_CATEGORIES.find(
    (entry) => entry.label.toLowerCase() === normalized
  );
  if (byLabel) return byLabel.slug;
  return CATEGORY_ALIASES[normalized] || '';
}

function buildAdminPushRoute(input) {
  const screen = normalizeText(input.screen || 'home').toLowerCase();
  if (!PUSH_ROUTE_SCREENS.includes(screen)) {
    throw createHttpError(`Unsupported route screen: ${screen}`, 400);
  }

  if (screen === 'category') {
    const categorySlug = normalizeCategorySlug(input.category);
    if (!categorySlug) {
      throw createHttpError('category is required for screen=category', 400);
    }
    const category = APP_CATEGORIES.find((entry) => entry.slug === categorySlug);
    return {
      data: {
        screen,
        category: categorySlug,
      },
      summary: {
        screen,
        category: categorySlug,
        categoryLabel: category ? category.label : categorySlug,
      },
    };
  }

  if (screen === 'item') {
    const itemId = normalizeText(input.itemId);
    if (!itemId) {
      throw createHttpError('itemId is required for screen=item', 400);
    }
    return {
      data: {
        screen,
        itemId,
      },
      summary: {
        screen,
        itemId,
      },
    };
  }

  if (screen === 'chat') {
    const chatId = normalizeText(input.chatId);
    if (!chatId) {
      throw createHttpError('chatId is required for screen=chat', 400);
    }
    return {
      data: {
        screen,
        chatId,
      },
      summary: {
        screen,
        chatId,
      },
    };
  }

  return {
    data: {screen},
    summary: {screen},
  };
}

function buildAudienceTargeting(input) {
  const source = isPlainObject(input) ? input : {};
  const mode = normalizeText(source.mode || 'subscribed').toLowerCase();

  if (!PUSH_AUDIENCE_MODES.includes(mode)) {
    throw createHttpError(`Unsupported audience mode: ${mode}`, 400);
  }

  if (mode === 'subscribed') {
    return {
      targeting: {
        included_segments: ['Subscribed Users'],
      },
      summary: {
        mode,
      },
    };
  }

  if (mode === 'tag') {
    const key = normalizeText(source.tagKey);
    const value = normalizeText(source.tagValue);
    if (!key || !value) {
      throw createHttpError('tagKey and tagValue are required for mode=tag', 400);
    }
    return {
      targeting: {
        filters: [{field: 'tag', key, relation: '=', value}],
      },
      summary: {
        mode,
        tagKey: key,
        tagValue: value,
      },
    };
  }

  const externalIds = parseList(source.externalIds);
  if (externalIds.length === 0) {
    throw createHttpError(
      'externalIds are required for mode=external_ids',
      400
    );
  }
  return {
    targeting: {
      include_aliases: {
        external_id: externalIds,
      },
      target_channel: 'push',
    },
    summary: {
      mode,
      externalIds,
    },
  };
}

function createHttpError(message, statusCode, responseBody = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.responseBody = responseBody;
  return error;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function pickOneSignalMeta(response) {
  if (!response || typeof response !== 'object') {
    return {raw: response};
  }
  return {
    id: response.id || null,
    recipients: response.recipients || null,
    externalId: response.external_id || null,
    errors: response.errors || null,
  };
}

function serializePushHistoryRecord(id, data) {
  return {
    id,
    title: data.title || '',
    body: data.body || '',
    templateId: data.templateId || 'custom',
    audience: data.audience || {},
    route: data.route || {},
    sentBy: data.sentBy || {},
    oneSignal: data.oneSignal || {},
    createdAt: serializeTimestamp(data.createdAt),
  };
}

async function readPushHistory(limit, authToken) {
  if (firestore) {
    const snapshot = await firestore
      .collection(PUSH_HISTORY_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) =>
      serializePushHistoryRecord(doc.id, doc.data() || {})
    );
  }

  const documents = await runFirestoreQuery(
    {
      from: [{collectionId: PUSH_HISTORY_COLLECTION}],
      orderBy: [
        {
          field: {fieldPath: 'createdAt'},
          direction: 'DESCENDING',
        },
      ],
      limit,
    },
    authToken
  );

  return documents.map((doc) => {
    const decoded = decodeFirestoreDocument(doc);
    return serializePushHistoryRecord(decoded.id || '', decoded);
  });
}

async function savePushHistory(record, authToken) {
  const payload = {
    ...record,
    createdAt: new Date().toISOString(),
  };

  if (firestore) {
    try {
      await firestore.collection(PUSH_HISTORY_COLLECTION).add(payload);
      return;
    } catch (error) {
      console.warn('Push history write failed via admin SDK:', error);
    }
  }

  if (!authToken) return;

  try {
    await createFirestoreDocument(PUSH_HISTORY_COLLECTION, payload, authToken);
  } catch (error) {
    console.warn('Push history write failed via Firestore REST:', error);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function requireAdmin(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  const bearerPrefix = 'Bearer ';
  if (!authHeader.startsWith(bearerPrefix)) {
    return res.status(401).json({error: 'Missing Bearer token'});
  }

  const token = authHeader.slice(bearerPrefix.length).trim();
  if (!token) {
    return res.status(401).json({error: 'Missing Bearer token'});
  }

  try {
    const verified = await verifyFirebaseUser(token);
    const userDoc = firestore
      ? await readUserRoleViaAdminSdk(verified.uid)
      : await readUserRoleViaRest(verified.uid, token);
    const role = userDoc.role || '';
    if (role !== 'admin') {
      return res.status(403).json({error: 'Admin role required'});
    }
    req.adminUser = {
      uid: verified.uid,
      email: verified.email || '',
    };
    req.adminToken = token;
    return next();
  } catch (error) {
    return res.status(401).json({error: 'Invalid admin token', details: String(error)});
  }
}

async function verifyFirebaseUser(idToken) {
  if (firestore) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email || '',
      };
    } catch (error) {
      console.warn('Firebase Admin verifyIdToken failed, falling back to REST:', error);
    }
  }

  if (!FIREBASE_PUBLIC_API_KEY) {
    throw new Error('Missing Firebase API key for REST auth fallback');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      FIREBASE_PUBLIC_API_KEY
    )}`,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({idToken}),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Firebase accounts:lookup failed: ${extractFirebaseRestError(payload)}`
    );
  }

  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  if (!user || !user.localId) {
    throw new Error('Firebase accounts:lookup returned no user');
  }

  return {
    uid: user.localId,
    email: user.email || '',
  };
}

async function readUserRoleViaAdminSdk(uid) {
  const userDoc = await firestore.collection('users').doc(uid).get();
  return userDoc.data() || {};
}

async function readUserRoleViaRest(uid, authToken) {
  const document = await getFirestoreDocument(`users/${uid}`, authToken);
  return decodeFirestoreDocument(document);
}

function getFirestoreDocumentsBaseUrl() {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Missing Firebase project id for Firestore REST access');
  }
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function getFirestoreDocument(documentPath, authToken) {
  const response = await fetch(
    `${getFirestoreDocumentsBaseUrl()}/${documentPath}`,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Firestore document read failed: ${extractFirebaseRestError(payload)}`
    );
  }
  return payload;
}

async function runFirestoreQuery(structuredQuery, authToken) {
  const response = await fetch(
    `${getFirestoreDocumentsBaseUrl()}:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({structuredQuery}),
    }
  );

  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(
      `Firestore query failed: ${extractFirebaseRestError(payload)}`
    );
  }

  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => entry.document)
    .filter(Boolean);
}

async function createFirestoreDocument(collectionId, data, authToken) {
  const response = await fetch(
    `${getFirestoreDocumentsBaseUrl()}/${collectionId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: encodeFirestoreFields(data),
      }),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Firestore create failed: ${extractFirebaseRestError(payload)}`
    );
  }

  return payload;
}

function encodeFirestoreFields(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data || {})) {
    fields[key] = encodeFirestoreValue(value);
  }
  return fields;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) {
    return {nullValue: null};
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => encodeFirestoreValue(entry)),
      },
    };
  }
  if (typeof value === 'boolean') {
    return {booleanValue: value};
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return {integerValue: String(value)};
    }
    return {doubleValue: value};
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: encodeFirestoreFields(value),
      },
    };
  }
  return {stringValue: String(value)};
}

function decodeFirestoreDocument(document) {
  const fields = document?.fields || {};
  const decoded = {
    id: document?.name ? String(document.name).split('/').pop() : '',
  };
  for (const [key, value] of Object.entries(fields)) {
    decoded[key] = decodeFirestoreValue(value);
  }
  return decoded;
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) {
    return value.stringValue;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) {
    return Number.parseInt(value.integerValue, 10);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) {
    return Number(value.doubleValue);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) {
    return Boolean(value.booleanValue);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) {
    return value.timestampValue;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) {
    return null;
  }
  if (value.mapValue && value.mapValue.fields) {
    const decoded = {};
    for (const [key, child] of Object.entries(value.mapValue.fields)) {
      decoded[key] = decodeFirestoreValue(child);
    }
    return decoded;
  }
  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values.map((entry) => decodeFirestoreValue(entry));
  }
  return null;
}

function extractFirebaseRestError(payload) {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => extractFirebaseRestError(entry))
      .filter(Boolean)
      .join('; ');
  }
  if (!payload || typeof payload !== 'object') {
    return String(payload || 'unknown error');
  }
  if (payload.error && typeof payload.error === 'string') {
    return payload.error;
  }
  if (payload.error && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  return JSON.stringify(payload);
}

async function sendOneSignalRequest(payload) {
  const response = await fetch(ONE_SIGNAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${ONE_SIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const parsed = parseMaybeJson(text);
  if (!response.ok) {
    throw createHttpError(
      typeof parsed === 'string' ? parsed : `OneSignal request failed with ${response.status}`,
      response.status,
      parsed
    );
  }
  return parsed;
}

function parseMaybeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function extractCloudinaryPublicId(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!parsed.hostname.includes('res.cloudinary.com')) return '';
    const uploadMarker = '/upload/';
    const uploadIndex = parsed.pathname.indexOf(uploadMarker);
    if (uploadIndex === -1) return '';

    let assetPath = parsed.pathname.slice(uploadIndex + uploadMarker.length);
    assetPath = assetPath.replace(/^v\d+\//, '');
    assetPath = assetPath.replace(/\.[a-z0-9]+$/i, '');
    return decodeURIComponent(assetPath).replace(/^\/+/, '');
  } catch (_error) {
    return '';
  }
}

function buildCloudinarySignature(publicId, timestamp) {
  const payload = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  return crypto.createHash('sha1').update(payload).digest('hex');
}

async function destroyCloudinaryAsset(publicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildCloudinarySignature(publicId, timestamp);
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: CLOUDINARY_API_KEY,
    signature,
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Cloudinary delete failed with ${response.status}`);
  }

  return parseMaybeJson(text);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`OneSignal push server running on ${port}`);
});
