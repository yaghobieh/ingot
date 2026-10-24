import type { Messages } from '@i18n/i18n.types';

export const he: Messages = {
    common: {
        signIn: 'התחברות', signUp: 'הרשמה', signOut: 'התנתקות', dashboard: 'לוח בקרה', pricing: 'תמחור', getStarted: 'להתחיל',
        save: 'שמירה', saved: 'נשמר', cancel: 'ביטול', delete: 'מחיקה', copy: 'העתקה', copied: 'הועתק', loading: 'טוען…',
        tbd: 'ייקבע', perMonth: '/ חודש', back: 'חזרה', continue: 'המשך', theme: 'ערכת נושא', language: 'שפה',
        light: 'בהיר', dark: 'כהה', system: 'מערכת', toggleTheme: 'החלפת ערכת נושא', openSource: 'קוד פתוח · Apache-2.0', never: 'אף פעם', menu: 'תפריט'
    },
    landing: {
        badge: 'סביבת פיתוח AI בקוד פתוח',
        title: 'סביבת פיתוח AI פתוחה ורגועה',
        subtitle: 'סוכנים, כל המודלים, קיצורי מקלדת של IDE שאתם כבר מכירים, ותוספים מ-Open VSX. עם המפתח שלכם או שלנו.',
        ctaPrimary: 'להתחיל בחינם', ctaSecondary: 'לתמחור', download: 'הורדה ל-macOS ול-Windows (בקרוב)',
        featuresTitle: 'כל מה שצריך, בלי מה שלא',
        features: {
            agents: { title: 'כמה סוכנים, כמה שיחות', body: 'הריצו סוכנים במקביל עם תוכנית, שלבים ושינויים בקוד שאפשר לאשר או לדחות.' },
            models: { title: 'כל המודלים בבורר אחד', body: 'Claude, GPT, Gemini, DeepSeek, Qwen, Llama ומודלים מקומיים, עם המפתחות שלכם או באירוח שלנו.' },
            keymap: { title: 'קיצורי IDE', body: 'Search Everywhere, Find Action, ריפקטורינג וכל הקיצורים שהידיים כבר מכירות.' },
            plugins: { title: 'תוספים וערכות צבע', body: 'חנות לתוספים ולערכות צבע מ-Open VSX, ו-SDK לפרסום תוספים משלכם.' },
            rules: { title: 'כללים ומיומנויות ב-.ingot', body: 'הקלידו / בסוכן כדי לקבל כללים, מיומנויות ופקודות. קורא גם את תיקיות הכללים הקיימות.' },
            sync: { title: 'מסונכרן בכל מקום', body: 'הגדרות, מודלים ברירת מחדל ושימוש מסונכרנים בין סביבת הפיתוח לפורטל.' }
        }
    },
    pricing: {
        title: 'תמחור פשוט והוגן',
        subtitle: 'מתחילים בחינם עם המפתחות שלכם. משדרגים כשרוצים מודלים מאורחים וסנכרון.',
        tbdNote: 'מחירי התוכניות בתשלום עדיין לא סופיים ומוצגים כ"ייקבע".',
        plans: {
            free: { name: 'חינם', desc: 'עם המפתח שלכם. סביבת הפיתוח המלאה, בחינם לתמיד.', cta: 'להתחיל בחינם' },
            pro: { name: 'Pro', desc: 'מודלים מאורחים והשלמה אוטומטית, בלי מפתחות.', cta: 'לבחור Pro' },
            team: { name: 'Team', desc: 'מושבים, תפקידים וכללים משותפים לצוות.', cta: 'לבחור Team' }
        },
        features: {
            byok: 'שימוש במפתחות מודל משלכם', allModels: 'כל המודלים בבורר', agents: 'סוכנים וכמה שיחות', plugins: 'תוספים וערכות צבע', community: 'תמיכת קהילה',
            everythingFree: 'כל מה שבחינם', hostedModels: 'מודלים מאורחים כלולים', autocomplete: 'השלמה אוטומטית מהירה', sync: 'סנכרון הגדרות', priority: 'תמיכה בעדיפות',
            everythingPro: 'כל מה שב-Pro', seats: 'חיוב לפי מושב', roles: 'תפקידי בעלים, מנהל וחבר', sharedRules: 'כללים ומיומנויות משותפים', adminUsage: 'לוח שימוש לצוות'
        },
        popular: 'הכי פופולרי'
    },
    auth: {
        signInTitle: 'התחברות ל-Ingot', signUpTitle: 'יצירת חשבון Ingot',
        signInSubtitle: 'נשלח לכם קוד בן 6 ספרות במייל.', signUpSubtitle: 'בחינם לתמיד עם המפתחות שלכם.',
        email: 'אימייל', name: 'שם', sendCode: 'שלחו לי קוד', or: 'או',
        github: 'המשך עם GitHub', google: 'המשך עם Google', notConfigured: 'עדיין לא מוגדר',
        noAccount: 'חדשים ב-Ingot?', haveAccount: 'כבר יש לכם חשבון?',
        verifyTitle: 'בדקו את המייל', verifySubtitle: 'הזינו את הקוד בן 6 הספרות ששלחנו אל {email}.', code: 'קוד אימות',
        verify: 'אימות', resend: 'שליחת קוד חדש', resent: 'קוד חדש בדרך.', changeEmail: 'שימוש במייל אחר',
        errors: {
            invalid_email: 'הזינו כתובת מייל תקינה.', invalid_code: 'הקוד שגוי. נסו שוב.', code_expired: 'תוקף הקוד פג. שלחו קוד חדש.',
            too_many_codes: 'נשלחו יותר מדי קודים. המתינו כמה דקות.', too_many_attempts: 'יותר מדי ניסיונות. שלחו קוד חדש.',
            oauth_failed: 'ההתחברות דרך הספק נכשלה. נסו שוב.', generic: 'משהו השתבש. נסו שוב.'
        }
    },
    nav: { overview: 'סקירה', usage: 'שימוש', models: 'מודלים', billing: 'תוכנית וחיוב', keys: 'מפתחות API', team: 'צוות', settings: 'הגדרות' },
    overview: {
        title: 'סקירה', range: '{days} הימים האחרונים', requests: 'בקשות', tokens: 'טוקנים', cost: 'הוצאה', plan: 'תוכנית',
        requestsByDay: 'בקשות ליום', tokensByDay: 'טוקנים ליום', costByModel: 'הוצאה לפי מודל',
        emptyTitle: 'עדיין אין שימוש', emptyBody: 'התחברו מסביבת הפיתוח Ingot והבקשות, הטוקנים וההוצאה יופיעו כאן.',
        loadSample: 'טעינת נתוני דוגמה', connectIde: 'חיבור סביבת הפיתוח', input: 'קלט', output: 'פלט'
    },
    usage: {
        title: 'שימוש', subtitle: 'כל בקשה שסביבת הפיתוח דיווחה, מהחדשה לישנה.', export: 'ייצוא CSV',
        date: 'תאריך', model: 'מודל', feature: 'יכולת', requests: 'בקשות', input: 'טוקני קלט', output: 'טוקני פלט', cost: 'עלות',
        prev: 'הקודם', next: 'הבא', page: 'עמוד {page} מתוך {pages}', empty: 'אין שימוש בטווח הזה.'
    },
    models: {
        title: 'מודלים', subtitle: 'בחרו אילו מודלים יופיעו בבורר של סביבת הפיתוח ומה ברירת המחדל לשיחות חדשות. מסונכרן לסביבת הפיתוח.',
        chat: 'שיחה וסוכנים', autocomplete: 'השלמה אוטומטית', default: 'ברירת מחדל', makeDefault: 'לקבוע כברירת מחדל', enabled: 'מופעל'
    },
    billing: {
        title: 'תוכנית וחיוב', currentPlan: 'התוכנית הנוכחית', status: 'סטטוס', renews: 'מתחדש', upgrade: 'שדרוג ל-{plan}',
        stubTitle: 'החיוב עדיין לא מחובר', stubBody: 'התשלום ייפתח ברגע שספק התשלומים יחובר. עד אז התוכנית נשארת חינם.',
        checkoutStubbed: 'התשלום עדיין לא זמין. לא בוצע חיוב.', none: 'אין מנוי', comparePlans: 'השוואת תוכניות'
    },
    keys: {
        title: 'מפתחות API',
        tokensTitle: 'אסימוני גישה של Ingot', tokensBody: 'אסימונים מאפשרים לסביבת הפיתוח ולסקריפטים לקרוא ל-API של Ingot. שמרו עליהם כמו על סיסמה.',
        tokenName: 'שם האסימון', createToken: 'יצירת אסימון', newToken: 'העתיקו את האסימון עכשיו. לא תוכלו לראות אותו שוב.',
        prefix: 'קידומת', noTokens: 'אין אסימונים עדיין.', revoke: 'ביטול', lastUsed: 'שימוש אחרון', created: 'נוצר', source: 'מקור', sources: { manual: 'ידני', device: 'התחברות מסביבת הפיתוח' },
        byokTitle: 'המפתח שלכם', byokBody: 'השתמשו במפתחות מודל משלכם בתוכנית החינמית. המפתחות מוצפנים ולא יוצגו שוב אחרי השמירה.',
        family: 'מודלים', label: 'תווית', secret: 'מפתח', baseUrl: 'כתובת בסיס', addKey: 'שמירת מפתח', noKeys: 'אין מפתחות שמורים.', ending: 'מסתיים ב-{last4}'
    },
    team: {
        title: 'צוות', noTeamTitle: 'יצירת צוות', noTeamBody: 'הזמינו חברי צוות, הגדירו תפקידים ושתפו כללים.',
        teamName: 'שם הצוות', create: 'יצירת צוות', members: 'חברים', invite: 'הזמנת חבר צוות', inviteEmail: 'כתובת מייל',
        role: 'תפקיד', roles: { owner: 'בעלים', admin: 'מנהל', member: 'חבר' }, sendInvite: 'שליחת הזמנה', pending: 'הזמנות ממתינות',
        inviteSent: 'ההזמנה נשלחה. אפשר גם לשתף את הקישור:', remove: 'הסרה', revokeInvite: 'ביטול', you: 'את/ה', expires: 'בתוקף עד'
    },
    settings: {
        title: 'הגדרות', profile: 'פרופיל', name: 'שם', email: 'אימייל', appearance: 'מראה',
        syncTitle: 'סנכרון עם סביבת הפיתוח', syncBody: 'גרסת הגדרות {version}. סביבת הפיתוח קוראת וכותבת אותן דרך ה-API של Ingot.', lastSync: 'עודכן לאחרונה'
    },
    device: {
        title: 'התחברות מ-Ingot', subtitle: 'הזינו את הקוד שמוצג בסביבת הפיתוח Ingot.', code: 'קוד מכשיר', lookup: 'המשך',
        confirm: '{client} מבקש להתחבר לחשבון ה-Ingot שלכם.', approve: 'אישור', deny: 'דחייה',
        approved: 'התחברתם. אפשר לחזור ל-Ingot.', denied: 'הבקשה נדחתה. שום דבר לא שותף.', invalid: 'הקוד שגוי או שתוקפו פג.'
    },
    invite: {
        title: 'הזמנה לצוות', body: 'הוזמנתם להצטרף ל-{team} בתפקיד {role}.', accept: 'קבלת ההזמנה',
        accepted: 'הצטרפתם לצוות.', invalid: 'ההזמנה לא תקינה או שתוקפה פג.', wrongEmail: 'ההזמנה נשלחה אל {email}. התחברו עם הכתובת הזו כדי לקבל אותה.',
        signIn: 'התחברו כדי לקבל'
    },
    errors: { generic: 'משהו השתבש. נסו שוב.', forbidden: 'אין לכם הרשאה לפעולה הזו.', encryption_not_configured: 'אחסון המפתחות לא מוגדר בשרת הזה.' }
};
