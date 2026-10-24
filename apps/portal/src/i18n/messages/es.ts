import type { Messages } from '@i18n/i18n.types';

export const es: Messages = {
    common: {
        signIn: 'Iniciar sesión', signUp: 'Registrarse', signOut: 'Cerrar sesión', dashboard: 'Panel', pricing: 'Precios', getStarted: 'Empezar',
        save: 'Guardar', saved: 'Guardado', cancel: 'Cancelar', delete: 'Eliminar', copy: 'Copiar', copied: 'Copiado', loading: 'Cargando…',
        tbd: 'Por definir', perMonth: '/ mes', back: 'Volver', continue: 'Continuar', theme: 'Tema', language: 'Idioma',
        light: 'Claro', dark: 'Oscuro', system: 'Sistema', toggleTheme: 'Cambiar tema', openSource: 'Código abierto · Apache-2.0', never: 'Nunca', menu: 'Menú'
    },
    landing: {
        badge: 'IDE de IA de código abierto',
        title: 'El IDE de IA abierto y tranquilo',
        subtitle: 'Agentes, todos los modelos, atajos de IDE que ya conoces y plugins de Open VSX. Usa tu propia clave o la nuestra.',
        ctaPrimary: 'Empieza gratis', ctaSecondary: 'Ver precios', download: 'Descarga para macOS y Windows (pronto)',
        featuresTitle: 'Todo lo que necesitas, nada que sobre',
        features: {
            agents: { title: 'Varios agentes, varios chats', body: 'Ejecuta agentes en paralelo con planes, pasos y diffs en línea que aceptas o rechazas.' },
            models: { title: 'Todos los modelos en un selector', body: 'Claude, GPT, Gemini, DeepSeek, Qwen, Llama y modelos locales, con tus claves o alojados.' },
            keymap: { title: 'Atajos de IDE', body: 'Search Everywhere, Find Action, refactorizaciones y los atajos que tus manos ya conocen.' },
            plugins: { title: 'Plugins y temas', body: 'Una tienda de extensiones y temas de color de Open VSX, y un SDK para publicar los tuyos.' },
            rules: { title: 'Reglas y skills en .ingot', body: 'Escribe / en el agente para ver reglas, skills y comandos. También lee tus carpetas de reglas existentes.' },
            sync: { title: 'Sincronizado en todas partes', body: 'Ajustes, modelos por defecto y uso se sincronizan entre el IDE y este portal.' }
        }
    },
    pricing: {
        title: 'Precios simples y justos',
        subtitle: 'Empieza gratis con tus propias claves. Mejora cuando quieras modelos alojados y sincronización.',
        tbdNote: 'Los precios de los planes de pago aún no son definitivos y se muestran como Por definir.',
        plans: {
            free: { name: 'Gratis', desc: 'Usa tu propia clave. El IDE completo, gratis para siempre.', cta: 'Empezar gratis' },
            pro: { name: 'Pro', desc: 'Modelos alojados y autocompletado, sin claves.', cta: 'Elegir Pro' },
            team: { name: 'Team', desc: 'Puestos, roles y reglas compartidas para tu equipo.', cta: 'Elegir Team' }
        },
        features: {
            byok: 'Usa tus propias claves de modelos', allModels: 'Todos los modelos en el selector', agents: 'Agentes y varios chats', plugins: 'Plugins y temas', community: 'Soporte de la comunidad',
            everythingFree: 'Todo lo de Gratis', hostedModels: 'Modelos alojados incluidos', autocomplete: 'Autocompletado rápido', sync: 'Sincronización de ajustes', priority: 'Soporte prioritario',
            everythingPro: 'Todo lo de Pro', seats: 'Facturación por puesto', roles: 'Roles de propietario, admin y miembro', sharedRules: 'Reglas y skills compartidas', adminUsage: 'Panel de uso del equipo'
        },
        popular: 'Más popular'
    },
    auth: {
        signInTitle: 'Inicia sesión en Ingot', signUpTitle: 'Crea tu cuenta de Ingot',
        signInSubtitle: 'Te enviaremos un código de 6 dígitos por correo.', signUpSubtitle: 'Gratis para siempre con tus propias claves.',
        email: 'Correo', name: 'Nombre', sendCode: 'Envíame un código', or: 'o',
        github: 'Continuar con GitHub', google: 'Continuar con Google', notConfigured: 'Aún no configurado',
        noAccount: '¿Nuevo en Ingot?', haveAccount: '¿Ya tienes cuenta?',
        verifyTitle: 'Revisa tu correo', verifySubtitle: 'Introduce el código de 6 dígitos que enviamos a {email}.', code: 'Código de verificación',
        verify: 'Verificar', resend: 'Reenviar código', resent: 'Un código nuevo va en camino.', changeEmail: 'Usar otro correo',
        errors: {
            invalid_email: 'Introduce un correo válido.', invalid_code: 'Ese código no es correcto. Inténtalo de nuevo.', code_expired: 'Ese código caducó. Envía uno nuevo.',
            too_many_codes: 'Demasiados códigos solicitados. Espera unos minutos.', too_many_attempts: 'Demasiados intentos. Envía un código nuevo.',
            oauth_failed: 'Falló el inicio de sesión con ese proveedor. Inténtalo de nuevo.', generic: 'Algo salió mal. Inténtalo de nuevo.'
        }
    },
    nav: { overview: 'Resumen', usage: 'Uso', models: 'Modelos', billing: 'Plan y facturación', keys: 'Claves API', team: 'Equipo', settings: 'Ajustes' },
    overview: {
        title: 'Resumen', range: 'Últimos {days} días', requests: 'Solicitudes', tokens: 'Tokens', cost: 'Gasto', plan: 'Plan',
        requestsByDay: 'Solicitudes por día', tokensByDay: 'Tokens por día', costByModel: 'Gasto por modelo',
        emptyTitle: 'Aún no hay uso', emptyBody: 'Inicia sesión desde el IDE Ingot y aquí verás tus solicitudes, tokens y gasto.',
        loadSample: 'Cargar uso de ejemplo', connectIde: 'Conectar el IDE', input: 'Entrada', output: 'Salida'
    },
    usage: {
        title: 'Uso', subtitle: 'Cada solicitud que reportó el IDE, de la más reciente a la más antigua.', export: 'Exportar CSV',
        date: 'Fecha', model: 'Modelo', feature: 'Función', requests: 'Solicitudes', input: 'Tokens de entrada', output: 'Tokens de salida', cost: 'Coste',
        prev: 'Anterior', next: 'Siguiente', page: 'Página {page} de {pages}', empty: 'No hay uso en este rango.'
    },
    models: {
        title: 'Modelos', subtitle: 'Elige qué modelos aparecen en el selector del IDE y el predeterminado para chats nuevos. Se sincroniza con el IDE.',
        chat: 'Chat y agentes', autocomplete: 'Autocompletado', default: 'Predeterminado', makeDefault: 'Hacer predeterminado', enabled: 'Activado'
    },
    billing: {
        title: 'Plan y facturación', currentPlan: 'Plan actual', status: 'Estado', renews: 'Se renueva', upgrade: 'Mejorar a {plan}',
        stubTitle: 'La facturación aún no está conectada', stubBody: 'El pago se abrirá cuando se conecte el proveedor de pagos. Hasta entonces tu plan sigue siendo Gratis.',
        checkoutStubbed: 'El pago aún no está disponible. No se cobró nada.', none: 'Sin suscripción', comparePlans: 'Comparar planes'
    },
    keys: {
        title: 'Claves API',
        tokensTitle: 'Tokens de acceso de Ingot', tokensBody: 'Los tokens permiten que el IDE y los scripts llamen a la API de Ingot. Trátalos como contraseñas.',
        tokenName: 'Nombre del token', createToken: 'Crear token', newToken: 'Copia este token ahora. No podrás volver a verlo.',
        prefix: 'Prefijo', noTokens: 'Aún no hay tokens.', revoke: 'Revocar', lastUsed: 'Último uso', created: 'Creado', source: 'Origen', sources: { manual: 'Manual', device: 'Inicio desde el IDE' },
        byokTitle: 'Usa tu propia clave', byokBody: 'Usa tus propias claves de modelos en el plan Gratis. Se cifran en reposo y no se vuelven a mostrar después de guardarlas.',
        family: 'Modelos', label: 'Etiqueta', secret: 'Clave', baseUrl: 'URL base', addKey: 'Guardar clave', noKeys: 'Aún no hay claves guardadas.', ending: 'termina en {last4}'
    },
    team: {
        title: 'Equipo', noTeamTitle: 'Crea un equipo', noTeamBody: 'Invita a compañeros, asigna roles y comparte reglas.',
        teamName: 'Nombre del equipo', create: 'Crear equipo', members: 'Miembros', invite: 'Invitar a un compañero', inviteEmail: 'Correo electrónico',
        role: 'Rol', roles: { owner: 'Propietario', admin: 'Admin', member: 'Miembro' }, sendInvite: 'Enviar invitación', pending: 'Invitaciones pendientes',
        inviteSent: 'Invitación enviada. También puedes compartir este enlace:', remove: 'Quitar', revokeInvite: 'Revocar', you: 'tú', expires: 'Caduca'
    },
    settings: {
        title: 'Ajustes', profile: 'Perfil', name: 'Nombre', email: 'Correo', appearance: 'Apariencia',
        syncTitle: 'Sincronización con el IDE', syncBody: 'Versión de ajustes {version}. El IDE los lee y escribe mediante la API de Ingot.', lastSync: 'Última actualización'
    },
    device: {
        title: 'Inicia sesión desde Ingot', subtitle: 'Introduce el código que muestra el IDE Ingot.', code: 'Código del dispositivo', lookup: 'Continuar',
        confirm: '{client} quiere iniciar sesión en tu cuenta de Ingot.', approve: 'Aprobar', deny: 'Rechazar',
        approved: 'Sesión iniciada. Ya puedes volver a Ingot.', denied: 'Solicitud rechazada. No se compartió nada.', invalid: 'Ese código no es válido o caducó.'
    },
    invite: {
        title: 'Invitación al equipo', body: 'Te invitaron a unirte a {team} como {role}.', accept: 'Aceptar invitación',
        accepted: 'Te uniste al equipo.', invalid: 'Esta invitación no es válida o caducó.', wrongEmail: 'Esta invitación se envió a {email}. Inicia sesión con ese correo para aceptarla.',
        signIn: 'Inicia sesión para aceptar'
    },
    errors: { generic: 'Algo salió mal. Inténtalo de nuevo.', forbidden: 'No tienes permiso para hacer eso.', encryption_not_configured: 'El almacenamiento de claves no está configurado en este servidor.' }
};
