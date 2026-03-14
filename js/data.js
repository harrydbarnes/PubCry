/* global PUB_DATA, TUBE_DATA */
'use strict';

/**
 * London pubs with real coordinates.
 * revealRadius: metres of fog cleared when this location is discovered.
 */
const PUB_DATA = [
  {
    id: 'pub-churchill-arms',
    name: 'The Churchill Arms',
    lat: 51.50425,
    lng: -0.19577,
    description: 'Kensington · Famous flower-covered façade',
    revealRadius: 380
  },
  {
    id: 'pub-cheshire-cheese',
    name: "Ye Olde Cheshire Cheese",
    lat: 51.51332,
    lng: -0.10553,
    description: "Fleet Street · Rebuilt 1667 after the Great Fire",
    revealRadius: 380
  },
  {
    id: 'pub-prospect-whitby',
    name: 'The Prospect of Whitby',
    lat: 51.50787,
    lng: -0.05639,
    description: "Wapping · London's oldest riverside pub, c.1520",
    revealRadius: 400
  },
  {
    id: 'pub-mayflower',
    name: 'The Mayflower',
    lat: 51.49749,
    lng: -0.04963,
    description: 'Rotherhithe · Named after the Pilgrim ship',
    revealRadius: 380
  },
  {
    id: 'pub-george-inn',
    name: 'The George Inn',
    lat: 51.50089,
    lng: -0.09133,
    description: "Borough · London's last galleried coaching inn",
    revealRadius: 380
  },
  {
    id: 'pub-blackfriar',
    name: 'The Blackfriar',
    lat: 51.51237,
    lng: -0.10416,
    description: 'Blackfriars · Ornate Arts and Crafts interior',
    revealRadius: 360
  },
  {
    id: 'pub-mitre',
    name: 'Ye Olde Mitre',
    lat: 51.51835,
    lng: -0.10878,
    description: 'Hatton Garden · Hidden gem, c.1546',
    revealRadius: 360
  },
  {
    id: 'pub-harp',
    name: 'The Harp',
    lat: 51.50906,
    lng: -0.12355,
    description: 'Covent Garden · Award-winning real ale pub',
    revealRadius: 380
  },
  {
    id: 'pub-coach-horses',
    name: 'The Coach & Horses',
    lat: 51.51193,
    lng: -0.13218,
    description: 'Soho · Legendary bohemian local',
    revealRadius: 360
  },
  {
    id: 'pub-french-house',
    name: 'The French House',
    lat: 51.51304,
    lng: -0.13105,
    description: "Soho · De Gaulle's WWII London haunt",
    revealRadius: 360
  },
  {
    id: 'pub-princess-louise',
    name: 'The Princess Louise',
    lat: 51.51736,
    lng: -0.11965,
    description: 'Holborn · Victorian gin palace with original fittings',
    revealRadius: 380
  },
  {
    id: 'pub-cittie-yorke',
    name: 'The Cittie of Yorke',
    lat: 51.51717,
    lng: -0.11252,
    description: 'Holborn · Tudor-style great hall',
    revealRadius: 360
  },
  {
    id: 'pub-seven-stars',
    name: 'The Seven Stars',
    lat: 51.51605,
    lng: -0.11267,
    description: "Holborn · Tiny 1602 pub behind the Law Courts",
    revealRadius: 340
  },
  {
    id: 'pub-old-bank-england',
    name: 'Old Bank of England',
    lat: 51.51309,
    lng: -0.11178,
    description: 'Temple · Former Law Courts branch of the BoE',
    revealRadius: 380
  },
  {
    id: 'pub-wenlock-arms',
    name: 'The Wenlock Arms',
    lat: 51.52848,
    lng: -0.08270,
    description: 'Hoxton · Champion of cask ales',
    revealRadius: 380
  },
  {
    id: 'pub-carpenters-arms',
    name: "The Carpenter's Arms",
    lat: 51.52618,
    lng: -0.06404,
    description: 'Bethnal Green · East End classic',
    revealRadius: 380
  },
  {
    id: 'pub-cat-mutton',
    name: 'The Cat & Mutton',
    lat: 51.53280,
    lng: -0.05773,
    description: 'Broadway Market · Buzzing Hackney local',
    revealRadius: 380
  },
  {
    id: 'pub-duke-cambridge',
    name: 'The Duke of Cambridge',
    lat: 51.53531,
    lng: -0.09783,
    description: "Islington · UK's first certified organic pub",
    revealRadius: 380
  },
  {
    id: 'pub-dove',
    name: 'The Dove',
    lat: 51.49161,
    lng: -0.23494,
    description: "Hammersmith · Thames-side, the world's smallest bar room",
    revealRadius: 400
  },
  {
    id: 'pub-windsor-castle',
    name: 'The Windsor Castle',
    lat: 51.51169,
    lng: -0.20067,
    description: 'Notting Hill · Traditional pub with walled garden',
    revealRadius: 380
  }
];

/**
 * London Underground tube stops with real coordinates.
 * Visiting a tube stop reveals a slightly larger area (transit hub bonus).
 */
const TUBE_DATA = [
  {
    id: 'tube-kings-cross',
    name: "King's Cross St. Pancras",
    lat: 51.53079,
    lng: -0.12376,
    description: 'Northern, Victoria, Piccadilly, Circle, Hammersmith & City, Metropolitan',
    revealRadius: 500
  },
  {
    id: 'tube-liverpool-st',
    name: 'Liverpool Street',
    lat: 51.51829,
    lng: -0.08172,
    description: 'Central, Circle, Hammersmith & City, Metropolitan',
    revealRadius: 500
  },
  {
    id: 'tube-bank',
    name: 'Bank / Monument',
    lat: 51.51286,
    lng: -0.08879,
    description: 'Central, Northern, Waterloo & City',
    revealRadius: 480
  },
  {
    id: 'tube-oxford-circus',
    name: 'Oxford Circus',
    lat: 51.51536,
    lng: -0.14158,
    description: 'Bakerloo, Central, Victoria',
    revealRadius: 500
  },
  {
    id: 'tube-bond-street',
    name: 'Bond Street',
    lat: 51.51434,
    lng: -0.15003,
    description: 'Central, Jubilee',
    revealRadius: 460
  },
  {
    id: 'tube-green-park',
    name: 'Green Park',
    lat: 51.50665,
    lng: -0.14280,
    description: 'Jubilee, Piccadilly, Victoria',
    revealRadius: 480
  },
  {
    id: 'tube-westminster',
    name: 'Westminster',
    lat: 51.50098,
    lng: -0.12548,
    description: 'Circle, District, Jubilee',
    revealRadius: 480
  },
  {
    id: 'tube-waterloo',
    name: 'Waterloo',
    lat: 51.50364,
    lng: -0.11362,
    description: 'Bakerloo, Jubilee, Northern, Waterloo & City',
    revealRadius: 500
  },
  {
    id: 'tube-london-bridge',
    name: 'London Bridge',
    lat: 51.50521,
    lng: -0.08636,
    description: 'Jubilee, Northern',
    revealRadius: 480
  },
  {
    id: 'tube-tower-hill',
    name: 'Tower Hill',
    lat: 51.50983,
    lng: -0.07651,
    description: 'Circle, District',
    revealRadius: 460
  },
  {
    id: 'tube-aldgate-east',
    name: 'Aldgate East',
    lat: 51.51509,
    lng: -0.07280,
    description: 'District, Hammersmith & City',
    revealRadius: 440
  },
  {
    id: 'tube-barbican',
    name: 'Barbican',
    lat: 51.52013,
    lng: -0.09757,
    description: 'Circle, Hammersmith & City, Metropolitan',
    revealRadius: 440
  },
  {
    id: 'tube-moorgate',
    name: 'Moorgate',
    lat: 51.51853,
    lng: -0.08824,
    description: 'Circle, Hammersmith & City, Metropolitan, Northern',
    revealRadius: 460
  },
  {
    id: 'tube-old-street',
    name: 'Old Street',
    lat: 51.52572,
    lng: -0.08784,
    description: 'Northern',
    revealRadius: 440
  },
  {
    id: 'tube-angel',
    name: 'Angel',
    lat: 51.53221,
    lng: -0.10574,
    description: 'Northern',
    revealRadius: 440
  },
  {
    id: 'tube-farringdon',
    name: 'Farringdon',
    lat: 51.52030,
    lng: -0.10491,
    description: 'Circle, Hammersmith & City, Metropolitan, Elizabeth',
    revealRadius: 460
  },
  {
    id: 'tube-chancery-lane',
    name: 'Chancery Lane',
    lat: 51.51451,
    lng: -0.11128,
    description: 'Central',
    revealRadius: 440
  },
  {
    id: 'tube-holborn',
    name: 'Holborn',
    lat: 51.51740,
    lng: -0.12009,
    description: 'Central, Piccadilly',
    revealRadius: 460
  },
  {
    id: 'tube-covent-garden',
    name: 'Covent Garden',
    lat: 51.51279,
    lng: -0.12433,
    description: 'Piccadilly',
    revealRadius: 440
  },
  {
    id: 'tube-leicester-sq',
    name: 'Leicester Square',
    lat: 51.51131,
    lng: -0.12806,
    description: 'Northern, Piccadilly',
    revealRadius: 460
  }
];
