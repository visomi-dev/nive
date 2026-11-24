import type { MarketingCopy } from './marketing-copy';

export const spanishMarketingCopy: MarketingCopy = {
  skip: 'Ir al contenido',
  home: 'Inicio',
  navigationLabel: 'Navegación principal',
  navigation: ['Tu dinero', 'Cómo funciona', 'Tu privacidad'],
  signIn: 'Entrar',
  start: 'Empezar',
  explore: 'Descubre cómo funciona',
  heroNote: 'Empieza por ti. Comparte solo cuando tú decidas.',
  availability: 'Los presupuestos, las importaciones y los espacios familiares aún están en desarrollo.',
  preview: {
    label: 'Ejemplo ilustrativo · MXN',
    space: 'Mi espacio',
    period: 'Este mes',
    remaining: 'Por gastar del presupuesto',
    planned: 'Planeado',
    spent: 'Gastado',
    categories: ['Despensa', 'Hogar', 'Gustos personales'],
  },
  product: {
    eyebrow: 'Menos pendientes. Más claridad.',
    title: 'Haz espacio para tu vida.',
    body: 'Reúne tus ingresos y gastos, conoce tu situación y arma un plan que funcione para ti.',
    cards: [
      {
        title: 'Tus movimientos, en un solo lugar.',
        body: 'Carga archivos CSV de tu banco y facturas CFDI 4.0. Revisa lo que necesita tu atención sin capturar cada compra a mano.',
        tag: 'Empieza con tus documentos',
      },
      {
        title: 'Un plan que sí entiendes.',
        body: 'Crea un presupuesto a partir de tus gastos anteriores. Revisa cómo se calcula cada monto y ajústalo a tus necesidades.',
        tag: 'Tú tienes la última palabra',
      },
      {
        title: 'Cada compra cuenta.',
        body: 'Organiza tus listas de compras junto a tu presupuesto. Distingue las estimaciones de lo que realmente gastas.',
        tag: 'Planea antes de gastar',
      },
    ],
  },
  steps: {
    eyebrow: 'Un comienzo más sencillo',
    title: 'Empieza con lo que ya tienes.',
    items: [
      {
        title: 'Crea tu espacio privado.',
        body: 'Configura tu bóveda y guarda tu clave de recuperación en un lugar seguro.',
      },
      {
        title: 'Agrega tus movimientos.',
        body: 'Carga un CSV de tu banco o una factura XML CFDI 4.0. Revisa y confirma los movimientos que necesiten tu atención.',
      },
      {
        title: 'Planea y ajusta.',
        body: 'Revisa tu presupuesto, lleva el control de tus gastos y usa lo que aprendas para planear el siguiente periodo.',
      },
    ],
  },
  privacy: {
    eyebrow: 'Lo personal sigue siendo personal',
    title: 'Tu dinero.\nTu espacio.',
    body: 'Tus cuentas personales están separadas de las de tu hogar. Pertenecer a una familia no da acceso a tu historial financiero personal.',
    recovery: 'Guarda tu clave de recuperación.',
    recoveryBody:
      'Necesitas tu clave de recuperación para acceder a tus datos financieros. Guarda una copia en un lugar seguro. Si la pierdes, restablecer tu contraseña no te devolverá el acceso a esos datos.',
    link: 'Lee la guía para empezar',
  },
  family: {
    eyebrow: 'Comparte los planes, no todas tus finanzas.',
    title: 'Organicen juntos los gastos del hogar.',
    body: 'Usa un espacio para las finanzas del hogar. Coordinen compras y aportaciones sin mezclarlas con sus cuentas personales.',
    points: [
      'Espacios personales y familiares separados',
      'Listas de compras y gastos del hogar compartidos',
      'Aportaciones claras y gastos registrados',
    ],
  },
  faq: {
    title: '¿Tienes dudas? Empieza aquí.',
    items: [
      {
        question: '¿Necesito crear una familia?',
        answer:
          'No. Empieza con tu bóveda privada. El espacio familiar es opcional: puedes crearlo cuando quieras coordinar las finanzas del hogar.',
      },
      {
        question: '¿Nive se conecta a mi banco?',
        answer:
          'Nive no se conecta a tu banco ni mueve dinero. Cuando esté disponible la importación, podrás importar un archivo CSV bancario o una factura XML CFDI 4.0, o registrar un movimiento tú mismo cuando esté disponible esa opción. No se admiten archivos PDF.',
      },
      {
        question: '¿Un presupuesto sugerido cambia mis saldos?',
        answer:
          'No. Un presupuesto propuesto es un plan que tú revisas y apruebas. Las estimaciones y los borradores están separados de los movimientos registrados.',
      },
      {
        question: '¿Qué pasa si pierdo mi clave de recuperación?',
        answer:
          'Guarda una copia segura antes de empezar. Si pierdes la clave, cambiar tu contraseña no recuperará el acceso a los datos financieros protegidos por ella.',
      },
    ],
  },
  closing: {
    title: 'Entiende tus finanzas.\nPlanea con más calma.',
    body: 'Empieza hoy a organizar tu dinero.',
  },
  footer: {
    line: 'Un lugar para tu dinero. Espacio para tu vida.',
    help: 'Guía para empezar',
    note: 'Nive te ayuda a organizar y planear. No guarda ni mueve tu dinero.',
  },
};
