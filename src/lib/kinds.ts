/**
 * OSM dice cos'è ogni posto, ma in inglese e a bassa leggibilità
 * (`shop=seafood`). Senza questa etichetta due risultati chiamati entrambi
 * "Big Ben" sono indistinguibili — uno è la torre, l'altro una pescheria.
 */

type Kind = { icon: string; label: string }

const BY_VALUE: Record<string, Kind> = {
  // Attrazioni
  attraction: { icon: '🎡', label: 'attrazione' },
  museum: { icon: '🏛️', label: 'museo' },
  gallery: { icon: '🖼️', label: 'galleria' },
  artwork: { icon: '🗿', label: 'opera d’arte' },
  monument: { icon: '🗿', label: 'monumento' },
  memorial: { icon: '🗿', label: 'memoriale' },
  clock: { icon: '🕰️', label: 'orologio' },
  castle: { icon: '🏰', label: 'castello' },
  palace: { icon: '🏰', label: 'palazzo' },
  ruins: { icon: '🏛️', label: 'rovine' },
  archaeological_site: { icon: '🏛️', label: 'sito archeologico' },
  viewpoint: { icon: '👁️', label: 'punto panoramico' },
  tower: { icon: '🗼', label: 'torre' },
  aquarium: { icon: '🐠', label: 'acquario' },
  zoo: { icon: '🦁', label: 'zoo' },
  theme_park: { icon: '🎢', label: 'parco divertimenti' },

  // Culto
  cathedral: { icon: '⛪', label: 'cattedrale' },
  church: { icon: '⛪', label: 'chiesa' },
  chapel: { icon: '⛪', label: 'cappella' },
  abbey: { icon: '⛪', label: 'abbazia' },
  place_of_worship: { icon: '⛪', label: 'luogo di culto' },

  // Verde e spazi aperti
  park: { icon: '🌳', label: 'parco' },
  garden: { icon: '🌳', label: 'giardino' },
  nature_reserve: { icon: '🌳', label: 'riserva naturale' },
  protected_area: { icon: '🌳', label: 'area protetta' },
  square: { icon: '🟦', label: 'piazza' },
  pier: { icon: '⚓', label: 'molo' },

  // Commercio
  marketplace: { icon: '🛍️', label: 'mercato' },
  market: { icon: '🛍️', label: 'mercato' },
  mall: { icon: '🛍️', label: 'centro commerciale' },
  department_store: { icon: '🛍️', label: 'grande magazzino' },
  supermarket: { icon: '🛒', label: 'supermercato' },
  convenience: { icon: '🛒', label: 'minimarket' },
  seafood: { icon: '🐟', label: 'pescheria' },
  butcher: { icon: '🥩', label: 'macelleria' },
  bakery: { icon: '🥖', label: 'panetteria' },
  books: { icon: '📚', label: 'libreria' },
  clothes: { icon: '👕', label: 'abbigliamento' },

  // Cibo e bevande
  restaurant: { icon: '🍽️', label: 'ristorante' },
  pub: { icon: '🍺', label: 'pub' },
  bar: { icon: '🍸', label: 'bar' },
  cafe: { icon: '☕', label: 'caffè' },
  fast_food: { icon: '🍔', label: 'fast food' },

  // Cultura e servizi
  theatre: { icon: '🎭', label: 'teatro' },
  cinema: { icon: '🎬', label: 'cinema' },
  library: { icon: '📚', label: 'biblioteca' },
  stadium: { icon: '🏟️', label: 'stadio' },
  university: { icon: '🎓', label: 'università' },
  college: { icon: '🎓', label: 'istituto' },
  hospital: { icon: '🏥', label: 'ospedale' },
  hotel: { icon: '🏨', label: 'hotel' },
  hostel: { icon: '🏨', label: 'ostello' },
  guest_house: { icon: '🏨', label: 'guest house' },

  // Trasporti
  station: { icon: '🚉', label: 'stazione' },
  train_station: { icon: '🚉', label: 'stazione' },
  subway: { icon: '🚇', label: 'metro' },

  // Luoghi
  neighbourhood: { icon: '🏙️', label: 'quartiere' },
  suburb: { icon: '🏙️', label: 'quartiere' },
  quarter: { icon: '🏙️', label: 'quartiere' },
  city: { icon: '🏙️', label: 'città' },
  town: { icon: '🏙️', label: 'cittadina' },
}

/** Se il valore specifico non è mappato, la famiglia dà comunque un'idea. */
const BY_KEY: Record<string, Kind> = {
  tourism: { icon: '🎡', label: 'turismo' },
  historic: { icon: '🏛️', label: 'luogo storico' },
  leisure: { icon: '🌳', label: 'svago' },
  shop: { icon: '🛒', label: 'negozio' },
  amenity: { icon: '📍', label: 'servizio' },
  building: { icon: '🏢', label: 'edificio' },
  place: { icon: '🏙️', label: 'zona' },
  boundary: { icon: '🗺️', label: 'area' },
  man_made: { icon: '🏗️', label: 'struttura' },
  railway: { icon: '🚉', label: 'stazione' },
  highway: { icon: '🛣️', label: 'strada' },
}

export function describeKind(key?: string, value?: string): Kind {
  return (
    (value ? BY_VALUE[value] : undefined) ??
    (key ? BY_KEY[key] : undefined) ?? { icon: '📍', label: 'luogo' }
  )
}
