const crypto = require('crypto');
const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({limit: '8mb'}));

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';
const ONE_SIGNAL_LEGACY_REST_API_KEY =
  process.env.ONESIGNAL_LEGACY_REST_API_KEY || '';
const ONE_SIGNAL_API_URL =
  process.env.ONESIGNAL_CREATE_MESSAGE_URL ||
  'https://api.onesignal.com/notifications';
const ONE_SIGNAL_LEGACY_PLAYERS_URL =
  'https://onesignal.com/api/v1/players';
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_UPLOAD_FOLDER =
  process.env.CLOUDINARY_UPLOAD_FOLDER || 'freeobmin/push';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'swap-e9630';
const FIREBASE_PUBLIC_API_KEY =
  process.env.FIREBASE_PUBLIC_API_KEY ||
  process.env.FIREBASE_WEB_API_KEY ||
  process.env.FIREBASE_API_KEY ||
  'AIzaSyCFfTBwF-HXWATxcknSaxguozhsxzNLYJA';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://freeobmin.pp.ua',
  'https://www.freeobmin.pp.ua',
  'https://admin.freeobmin.pp.ua',
  // Stable Netlify alias for the CRM redesign preview.
  'https://crm-preview--freeobmin.netlify.app',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8888',
];

const ADMIN_ALLOWED_ORIGINS = parseList(process.env.ADMIN_ALLOWED_ORIGINS);
const ONE_SIGNAL_SEGMENTS_CACHE_TTL_MS = 5 * 60 * 1000;

const PUSH_TEMPLATES = [
  {
    id: 'custom',
    name: 'Власний push',
    description: 'Створи повідомлення вручну, обери маршрут і додай своє фото.',
    badge: 'Гнучкий',
    accent: 'sand',
    defaults: {
      title: '',
      subtitle: '',
      body: '',
      screen: 'home',
    },
  },
  {
    id: 'fresh_category_drop',
    name: 'Свіжі знахідки',
    description: 'Стильний шаблон для нових речей у конкретній категорії.',
    badge: 'Категорія',
    accent: 'lime',
    defaults: {
      title: 'Щойно з’явилися нові речі',
      subtitle: 'Відкрий добірку за секунду',
      body: 'Заходь у категорію та подивись, що вже віддають безкоштовно.',
      screen: 'category',
      category: 'clothes',
    },
  },
  {
    id: 'item_spotlight',
    name: 'Річ, яку варто забрати',
    description: 'Перекидає одразу в картку конкретного оголошення.',
    badge: 'Точково',
    accent: 'peach',
    defaults: {
      title: 'Поглянь на цю знахідку',
      subtitle: 'Може підійти саме тобі',
      body: 'Відкрий оголошення та перевір деталі, поки річ ще доступна.',
      screen: 'item',
    },
  },
  {
    id: 'chat_nudge',
    name: 'Вам відповіли',
    description: 'Повертає користувача в потрібний чат після натискання.',
    badge: 'Чат',
    accent: 'sky',
    defaults: {
      title: 'У тебе нова відповідь',
      subtitle: 'Не загуби домовленість',
      body: 'Зайди в чат, щоб швидко відповісти та домовитися про передачу речі.',
      screen: 'chat',
    },
  },
  {
    id: 'comeback_digest',
    name: 'Повернення у стрічку',
    description: 'Нагадування для неактивних користувачів з теплим тоном.',
    badge: 'Реактивація',
    accent: 'olive',
    defaults: {
      title: 'У FreeObmin вже є нові речі',
      subtitle: 'Зазирни в стрічку сьогодні',
      body: 'Поки тебе не було, з’явилися цікаві безкоштовні речі. Перевір новинки просто зараз.',
      screen: 'home',
    },
  },
];

const APP_CATEGORIES = [
  {slug: 'electronics', label: 'Електроніка'},
  {slug: 'phones', label: 'Телефони та гаджети'},
  {slug: 'computers', label: 'Комп’ютери та офіс'},
  {slug: 'clothes', label: 'Одяг і взуття'},
  {slug: 'kids', label: 'Дитячі речі'},
  {slug: 'home', label: 'Для дому'},
  {slug: 'furniture', label: 'Меблі'},
  {slug: 'kitchen', label: 'Кухня'},
  {slug: 'books', label: 'Книги'},
  {slug: 'sport', label: 'Спорт'},
  {slug: 'hobby', label: 'Хобі'},
  {slug: 'beauty', label: 'Краса і догляд'},
  {slug: 'pets', label: 'Для тварин'},
  {slug: 'auto', label: 'Авто'},
  {slug: 'garden', label: 'Сад і город'},
  {slug: 'tools', label: 'Інструменти'},
  {slug: 'games', label: 'Ігри'},
  {slug: 'other', label: 'Інше'},
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
const PUSH_AUDIENCE_MODES = [
  'subscribed',
  'tag',
  'external_ids',
  'subscription_ids',
];
const PUSH_HISTORY_COLLECTION = 'admin_push_logs';
let cachedSubscribedSegment = {
  name: '',
  checkedAt: 0,
  available: [],
};

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
    cloudinaryReady: Boolean(
      CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
    ),
    firebaseInitError: firebaseInitError || null,
  });
});

app.post('/notify', requireAuthenticatedUser, async (req, res) => {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    return res.status(500).json({error: 'Missing OneSignal config'});
  }

  const {
    to,
    userId,
    toUserId,
    title,
    body,
    url,
    appUrl,
    data,
    type,
    senderName,
  } = req.body || {};

  let subscriptionId = normalizeText(to);
  const targetUserId = normalizeText(userId || toUserId);

  if (!subscriptionId && targetUserId) {
    if (!firestore) {
      return res.status(500).json({
        error: 'Push server is missing admin Firestore access',
      });
    }
    try {
      const userDoc = await readUserRoleViaAdminSdk(targetUserId);
      subscriptionId = normalizeText(userDoc.oneSignalId);
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to resolve target user push subscription',
        details: String(error),
      });
    }
  }

  if (!subscriptionId || !title || !body) {
    return res.status(400).json({error: 'target user and title/body required'});
  }

  const formatted = formatNotification({
    title,
    body,
    type,
    senderName,
  });

  const payload = {
    app_id: ONE_SIGNAL_APP_ID,
    include_subscription_ids: [subscriptionId],
    target_channel: 'push',
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
    mediaUploadEnabled: Boolean(
      CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
    ),
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

app.get('/api/push/subscriptions', requireAdmin, async (req, res) => {
  const limit = clampInteger(req.query.limit, 150, 1, 500);

  try {
    const directory = await readPushSubscriptionDirectory(limit, req.adminToken);
    return res.json({
      ok: true,
      source: directory.source,
      legacyEnabled: Boolean(ONE_SIGNAL_LEGACY_REST_API_KEY),
      items: directory.items,
      total: directory.total,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.message || String(error),
      response: error.responseBody || null,
    });
  }
});

app.post('/api/push/send', requireAdmin, async (req, res) => {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    return res.status(500).json({error: 'Missing OneSignal config'});
  }

  let historyRecord = null;
  let requestDebug = null;

  try {
    const input = req.body || {};
    const template = resolveTemplate(input.templateId);
    const title = normalizeText(input.title || template.defaults.title);
    const subtitle = normalizeText(input.subtitle || template.defaults.subtitle);
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

    const audience = await buildAudienceTargeting(input.audience);
    const media = buildPushMedia(input.media || input);
    const payload = {
      app_id: ONE_SIGNAL_APP_ID,
      headings: {en: title},
      contents: {en: body},
      data: route.data,
      ...audience.targeting,
      ...media.payload,
    };
    if (subtitle) {
      payload.subtitle = {en: subtitle};
    }

    requestDebug = buildOneSignalPayloadDebug(payload);
    historyRecord = {
      title,
      subtitle,
      body,
      templateId: template.id,
      audience: audience.summary,
      route: route.summary,
      media: media.summary,
      requestDebug,
      sentBy: {
        uid: req.adminUser.uid,
        email: req.adminUser.email || '',
      },
    };

    console.log(
      '[push-send] request',
      JSON.stringify({
        templateId: template.id,
        audienceMode: audience.summary.mode,
        requestDebug,
      })
    );

    let response = await sendOneSignalRequest(payload);
    let initialRequestDebug = requestDebug;

    if (shouldRetryDefaultPushAudience(response, audience.summary, payload)) {
      const retryPayload = buildDefaultPushAudiencePayload(payload);
      const retryDebug = buildOneSignalPayloadDebug(retryPayload);
      console.warn(
        '[push-send] retrying without explicit segments',
        JSON.stringify({
          templateId: template.id,
          initialRequestDebug,
          retryDebug,
        })
      );
      response = await sendOneSignalRequest(retryPayload);
      requestDebug = {
        ...retryDebug,
        fallbackApplied: true,
        initialIncludedSegments: initialRequestDebug.includedSegments || [],
      };
    }

    const oneSignalMeta = pickOneSignalMeta(response);
    console.log(
      '[push-send] response',
      JSON.stringify({
        templateId: template.id,
        requestDebug,
        oneSignal: oneSignalMeta,
      })
    );

    await savePushHistory(
      {
      ...historyRecord,
      requestDebug,
      oneSignal: oneSignalMeta,
      },
      req.adminToken
    );

    return res.json({
      ok: true,
      template: template.id,
      audience: audience.summary,
      route: route.summary,
      media: media.summary,
      requestDebug,
      oneSignal: oneSignalMeta,
    });
  } catch (error) {
    const oneSignalMeta = pickOneSignalMeta(error.responseBody);
    if (historyRecord) {
      try {
        await savePushHistory(
          {
            ...historyRecord,
            oneSignal: {
              ...oneSignalMeta,
              statusCode: error.statusCode || null,
              message: error.message || String(error),
            },
          },
          req.adminToken
        );
      } catch (_historyError) {
        // Ignore history failures in the error path.
      }
    }
    console.warn(
      '[push-send] failed',
      JSON.stringify({
        requestDebug,
        statusCode: error.statusCode || 400,
        error: error.message || String(error),
        response: error.responseBody || null,
      })
    );
    return res.status(error.statusCode || 400).json({
      error: error.message || String(error),
      response: error.responseBody || null,
      requestDebug,
      oneSignal: oneSignalMeta,
    });
  }
});

app.post('/media/upload', requireAdmin, async (req, res) => {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return res.status(500).json({error: 'Missing Cloudinary config'});
  }

  const source = req.body || {};
  const dataUrl = String(source.dataUrl || '').trim();
  const filename = normalizeUploadFilename(source.filename || 'push-image');

  if (!isImageDataUrl(dataUrl)) {
    return res.status(400).json({error: 'dataUrl image is required'});
  }

  try {
    const uploaded = await uploadCloudinaryImage(dataUrl, filename);
    return res.json({
      ok: true,
      url: uploaded.secure_url || uploaded.url || '',
      publicId: uploaded.public_id || '',
      width: uploaded.width || null,
      height: uploaded.height || null,
      bytes: uploaded.bytes || null,
      format: uploaded.format || null,
    });
  } catch (error) {
    return res.status(500).json({error: String(error)});
  }
});

app.post('/media/delete', requireAdmin, async (req, res) => {
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
  // Keep the production admin host enabled even when Render has an older
  // ADMIN_ALLOWED_ORIGINS value configured. The browser sends an OPTIONS
  // preflight before the protected CRM endpoints, so CORS must be answered
  // before requireAdmin runs.
  const allowed = [
    ...new Set([...DEFAULT_ALLOWED_ORIGINS, ...ADMIN_ALLOWED_ORIGINS]),
  ];
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
  return /^Від:\s/i.test(String(body || '')) || String(body || '').includes('\n');
}

function formatChatBody(body, senderName) {
  if (looksFormatted(body)) return body;
  const sender = normalizeText(senderName) || 'користувача';
  const message = truncateText(
    body || 'Відкрий чат, щоб прочитати повідомлення.'
  );
  return `Від: ${sender}\n${message}`;
}

function formatSystemBody(body, senderName) {
  if (looksFormatted(body)) return body;
  const sender = normalizeText(senderName) || 'команди FreeObmin';
  const message = truncateText(body || 'Нове системне повідомлення');
  return `Від: ${sender}\n${message}`;
}

function formatNotification({title, body, type, senderName}) {
  const normalizedTitle = normalizeText(title);
  const normalizedBody = String(body || '');
  const kind = normalizeText(type).toLowerCase();

  if (kind === 'chat' || normalizedTitle.toLowerCase().includes('повідом')) {
    return {
      title: normalizedTitle || 'Нове повідомлення',
      body: formatChatBody(normalizedBody, senderName),
    };
  }

  return {
    title: normalizedTitle || 'Сповіщення',
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

async function buildAudienceTargeting(input) {
  const source = isPlainObject(input) ? input : {};
  const mode = normalizeText(source.mode || 'subscribed').toLowerCase();

  if (!PUSH_AUDIENCE_MODES.includes(mode)) {
    throw createHttpError(`Unsupported audience mode: ${mode}`, 400);
  }

  if (mode === 'subscribed') {
    const segment = await resolveSubscribedSegment();
    return {
      targeting: {
        included_segments: [segment.name],
        target_channel: 'push',
      },
      summary: {
        mode,
        segmentName: segment.name,
        availableSegments: segment.available,
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
        target_channel: 'push',
      },
      summary: {
        mode,
        tagKey: key,
        tagValue: value,
      },
    };
  }

  if (mode === 'external_ids') {
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

  const subscriptionIds = parseList(
    source.subscriptionIds || source.subscription_ids
  );
  if (subscriptionIds.length === 0) {
    throw createHttpError(
      'subscriptionIds are required for mode=subscription_ids',
      400
    );
  }
  return {
    targeting: {
      include_subscription_ids: subscriptionIds,
      target_channel: 'push',
    },
    summary: {
      mode,
      subscriptionIds,
    },
  };
}

async function resolveSubscribedSegment() {
  const now = Date.now();
  if (
    cachedSubscribedSegment.name &&
    now - cachedSubscribedSegment.checkedAt < ONE_SIGNAL_SEGMENTS_CACHE_TTL_MS
  ) {
    return cachedSubscribedSegment;
  }

  const fallback = {
    name: 'Subscribed Users',
    checkedAt: now,
    available: [],
  };

  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY) {
    cachedSubscribedSegment = fallback;
    return fallback;
  }

  try {
    const response = await fetch(
      `https://api.onesignal.com/apps/${ONE_SIGNAL_APP_ID}/segments`,
      {
        method: 'GET',
        headers: {
          Authorization: buildOneSignalAuthorizationHeader(
            ONE_SIGNAL_REST_API_KEY
          ),
        },
      }
    );

    const text = await response.text();
    const parsed = parseMaybeJson(text);
    if (!response.ok) {
      throw createHttpError(
        extractOneSignalErrorMessage(parsed) ||
          `OneSignal segments request failed with ${response.status}`,
        response.status,
        parsed
      );
    }

    const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const names = segments
      .map((segment) => normalizeText(segment?.name))
      .filter(Boolean);
    const preferredName =
      names.find((name) => name === 'Subscribed Users') ||
      names.find((name) => name === 'All Subscribers') ||
      names.find((name) => /subscribers?/i.test(name)) ||
      names.find((name) => /subscribed/i.test(name)) ||
      fallback.name;

    cachedSubscribedSegment = {
      name: preferredName,
      checkedAt: now,
      available: names,
    };
  } catch (error) {
    console.warn(
      '[push-send] segment lookup failed',
      JSON.stringify({
        error: error.message || String(error),
        response: error.responseBody || null,
      })
    );
    cachedSubscribedSegment = fallback;
  }

  return cachedSubscribedSegment;
}

function createHttpError(message, statusCode, responseBody = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.responseBody = responseBody;
  return error;
}

function buildPushMedia(input) {
  const imageUrl = normalizeText(input.imageUrl || input.image_url);
  if (!imageUrl) {
    return {
      payload: {},
      summary: {},
    };
  }

  return {
    payload: {
      big_picture: imageUrl,
      chrome_web_image: imageUrl,
      huawei_big_picture: imageUrl,
      ios_attachments: {
        push_image: imageUrl,
      },
    },
    summary: {
      imageUrl,
    },
  };
}

function shouldRetryDefaultPushAudience(response, audienceSummary, payload) {
  if (!response || typeof response !== 'object') return false;
  if (!audienceSummary || audienceSummary.mode !== 'subscribed') return false;
  if (!Array.isArray(payload?.included_segments) || payload.included_segments.length === 0) {
    return false;
  }

  const errorsText = extractOneSignalErrorMessage(response);
  return (
    !normalizeText(response.id) &&
    errorsText.includes('All included players are not subscribed')
  );
}

function buildDefaultPushAudiencePayload(payload) {
  const nextPayload = {...payload};
  delete nextPayload.included_segments;
  delete nextPayload.excluded_segments;
  nextPayload.target_channel = 'push';
  return nextPayload;
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
    statusCode: response.statusCode || null,
    message: response.message || null,
  };
}

function buildOneSignalPayloadDebug(payload) {
  const includedSegments = Array.isArray(payload.included_segments)
    ? payload.included_segments
    : [];
  const excludedSegments = Array.isArray(payload.excluded_segments)
    ? payload.excluded_segments
    : [];
  const subscriptionIds = Array.isArray(payload.include_subscription_ids)
    ? payload.include_subscription_ids
    : [];
  const externalIds = Array.isArray(payload.include_aliases?.external_id)
    ? payload.include_aliases.external_id
    : [];
  const filters = Array.isArray(payload.filters) ? payload.filters : [];

  let targetingType = 'unknown';
  if (includedSegments.length > 0 || excludedSegments.length > 0) {
    targetingType = 'segments';
  } else if (subscriptionIds.length > 0) {
    targetingType = 'subscription_ids';
  } else if (externalIds.length > 0) {
    targetingType = 'external_ids';
  } else if (filters.length > 0) {
    targetingType = 'filters';
  } else if (payload.target_channel === 'push') {
    targetingType = 'default_push_audience';
  }

  return {
    appId: payload.app_id || '',
    targetChannel: payload.target_channel || '',
    targetingType,
    includedSegments,
    excludedSegments,
    subscriptionIdCount: subscriptionIds.length,
    externalIdCount: externalIds.length,
    filterCount: filters.length,
    hasData: isPlainObject(payload.data) && Object.keys(payload.data).length > 0,
    hasImage: Boolean(
      payload.big_picture ||
      payload.chrome_web_image ||
      payload.huawei_big_picture ||
      (isPlainObject(payload.ios_attachments) &&
        Object.keys(payload.ios_attachments).length > 0)
    ),
  };
}

function serializePushHistoryRecord(id, data) {
  return {
    id,
    title: data.title || '',
    subtitle: data.subtitle || '',
    body: data.body || '',
    templateId: data.templateId || 'custom',
    audience: data.audience || {},
    route: data.route || {},
    media: data.media || {},
    requestDebug: data.requestDebug || {},
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

async function readPushSubscriptionDirectory(limit, authToken) {
  if (ONE_SIGNAL_LEGACY_REST_API_KEY) {
    try {
      return await readOneSignalPlayersDirectory(limit);
    } catch (error) {
      console.warn(
        '[push-directory] legacy lookup failed',
        JSON.stringify({
          error: error.message || String(error),
          response: error.responseBody || null,
        })
      );
    }
  }

  return readFirestoreSubscriptionDirectory(limit, authToken);
}

async function readOneSignalPlayersDirectory(limit) {
  const items = [];
  let total = 0;
  let offset = 0;

  while (items.length < limit) {
    const pageLimit = Math.min(300, Math.max(50, limit - items.length));
    const url =
      `${ONE_SIGNAL_LEGACY_PLAYERS_URL}?app_id=${encodeURIComponent(
        ONE_SIGNAL_APP_ID
      )}&limit=${pageLimit}&offset=${offset}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildOneSignalLegacyAuthorizationHeader(
          ONE_SIGNAL_LEGACY_REST_API_KEY
        ),
      },
    });

    const text = await response.text();
    const parsed = parseMaybeJson(text);
    if (!response.ok) {
      throw createHttpError(
        extractOneSignalErrorMessage(parsed) ||
          `OneSignal players request failed with ${response.status}`,
        response.status,
        parsed
      );
    }

    const players = Array.isArray(parsed?.players) ? parsed.players : [];
    total = Number(parsed?.total_count || total || 0);

    for (const player of players) {
      if (!isActiveLegacyPlayer(player)) continue;
      items.push(serializeLegacyPlayer(player));
      if (items.length >= limit) break;
    }

    if (players.length < pageLimit) break;
    offset += players.length;
  }

  return {
    source: 'onesignal_legacy',
    total: total || items.length,
    items,
  };
}

async function readFirestoreSubscriptionDirectory(limit, authToken) {
  if (firestore) {
    const snapshot = await firestore
      .collection('users')
      .where('oneSignalId', '>', '')
      .orderBy('oneSignalId')
      .limit(limit)
      .get();

    const items = snapshot.docs
      .map((doc) => serializeFirestoreSubscription(doc.id, doc.data() || {}))
      .filter(Boolean);

    return {
      source: 'firestore_users',
      total: items.length,
      items,
    };
  }

  if (!authToken) {
    throw createHttpError('Firestore is not ready', 500);
  }

  const documents = await runFirestoreQuery(
    {
      from: [{collectionId: 'users'}],
      where: {
        fieldFilter: {
          field: {fieldPath: 'oneSignalId'},
          op: 'GREATER_THAN',
          value: {stringValue: ''},
        },
      },
      orderBy: [
        {
          field: {fieldPath: 'oneSignalId'},
          direction: 'ASCENDING',
        },
      ],
      limit,
    },
    authToken
  );

  const items = documents
    .map((doc) => {
      const decoded = decodeFirestoreDocument(doc);
      return serializeFirestoreSubscription(decoded.id || '', decoded);
    })
    .filter(Boolean);

  return {
    source: 'firestore_users',
    total: items.length,
    items,
  };
}

function serializeFirestoreSubscription(uid, data) {
  const subscriptionId = normalizeText(data.oneSignalId);
  if (!subscriptionId) return null;

  const name = normalizeText(data.name || data.displayName || data.email || '');
  return {
    subscriptionId,
    label: name || `User ${uid.slice(0, 8)}`,
    deviceName: '',
    platform: '',
    externalId: uid,
    identifier: '',
    lastActiveAt: normalizeText(data.lastSeen || ''),
    source: 'firestore_users',
  };
}

function isActiveLegacyPlayer(player) {
  const id = normalizeText(player?.id);
  if (!id) return false;
  if (player?.invalid_identifier === true) return false;

  const notificationTypes = Number(player?.notification_types);
  if (Number.isFinite(notificationTypes) && notificationTypes <= 0) {
    return false;
  }

  return true;
}

function serializeLegacyPlayer(player) {
  const subscriptionId = normalizeText(player?.id);
  const deviceName = normalizeText(player?.device_model || player?.model || '');
  const platform = formatLegacyDeviceLabel(
    player?.device_type,
    player?.device_os
  );
  const externalId = normalizeText(player?.external_user_id);
  const identifier = normalizeText(player?.identifier);
  const label =
    deviceName ||
    platform ||
    externalId ||
    maskSubscriptionIdentifier(identifier) ||
    `Subscription ${subscriptionId.slice(0, 8)}`;

  return {
    subscriptionId,
    label,
    deviceName,
    platform,
    externalId,
    identifier: maskSubscriptionIdentifier(identifier),
    lastActiveAt: formatUnixTimestamp(player?.last_active),
    source: 'onesignal_legacy',
  };
}

function formatLegacyDeviceLabel(deviceType, deviceOs) {
  const code = Number(deviceType);
  const os = normalizeText(deviceOs);
  const platform =
    {
      0: 'iOS',
      1: 'Android',
      2: 'Amazon',
      5: 'Windows',
      7: 'macOS',
      8: 'Web',
      9: 'Huawei',
      11: 'Chrome',
      14: 'Safari',
      15: 'Firefox',
    }[code] || '';

  if (platform && os) return `${platform} ${os}`;
  return platform || os;
}

function maskSubscriptionIdentifier(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

function formatUnixTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp * 1000).toISOString();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function requireAuthenticatedUser(req, res, next) {
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
    req.authUser = {
      uid: verified.uid,
      email: verified.email || '',
    };
    req.authToken = token;
    return next();
  } catch (error) {
    return res.status(401).json({error: 'Invalid auth token', details: String(error)});
  }
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
  const authorizationHeader = buildOneSignalAuthorizationHeader(
    ONE_SIGNAL_REST_API_KEY
  );
  const response = await fetch(ONE_SIGNAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorizationHeader,
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

function buildOneSignalAuthorizationHeader(apiKey) {
  const normalized = normalizeText(apiKey);
  if (!normalized) return '';
  if (
    normalized.startsWith('Key ') ||
    normalized.startsWith('Basic ')
  ) {
    return normalized;
  }
  return `Key ${normalized}`;
}

function buildOneSignalLegacyAuthorizationHeader(apiKey) {
  const normalized = normalizeText(apiKey);
  if (!normalized) return '';
  if (normalized.startsWith('Basic ')) {
    return normalized;
  }
  return `Basic ${normalized}`;
}

function parseMaybeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function normalizeUploadFilename(value) {
  return String(value || 'push-image')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function isImageDataUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ''));
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

function buildCloudinarySignatureFromParams(params) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(`${payload}${CLOUDINARY_API_SECRET}`)
    .digest('hex');
}

function buildCloudinarySignature(publicId, timestamp) {
  const payload = {public_id: publicId, timestamp};
  return buildCloudinarySignatureFromParams(payload);
}

async function uploadCloudinaryImage(dataUrl, filename) {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = normalizeUploadFilename(filename);
  const uploadParams = {
    folder: CLOUDINARY_UPLOAD_FOLDER,
    public_id: publicId,
    timestamp: String(timestamp),
  };
  const signature = buildCloudinarySignatureFromParams(uploadParams);
  const body = new URLSearchParams({
    file: dataUrl,
    folder: CLOUDINARY_UPLOAD_FOLDER,
    timestamp: String(timestamp),
    api_key: CLOUDINARY_API_KEY,
    signature,
    public_id: publicId,
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  );

  const text = await response.text();
  const parsed = parseMaybeJson(text);
  if (!response.ok) {
    throw new Error(
      typeof parsed === 'string'
        ? parsed
        : `Cloudinary upload failed with ${response.status}`
    );
  }

  return parsed;
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
