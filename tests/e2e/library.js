// Shared helpers for reading what the app saved (issue #80). The saved
// document used to be the single `hItinerary` value; it is now the working
// copy of whichever trip is current in the library.

/** The document the app currently has saved, or null when nothing is. */
export function savedDoc(page) {
  return page.evaluate(() => {
    const id = localStorage.getItem('hCurrentTrip');
    const raw = id && localStorage.getItem('hTrip:' + id);
    return raw ? JSON.parse(raw) : null;
  });
}

/** The library index: one row per saved trip, most recently edited first. */
export function savedIndex(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('hTrips') || '[]'));
}

/** The stored revision list for a trip (metadata only — the documents in it
    are compressed). */
export function savedRevisions(page, tripId) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('hTripHist:' + id) || '[]'), tripId);
}
