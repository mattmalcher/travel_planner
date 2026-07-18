import { test, expect } from '@playwright/test';

const genericItinerary = {
  trip: {
    name: "Summer Rail Tour 2026",
    travellers: ["Judy Jetson", "George Jetson"],
    start: "2026-09-18",
    end: "2026-09-28",
    currency_primary: "GBP"
  },
  segments: [
    {
      id: "seg-1",
      type: "transport",
      mode: "train",
      operator: "Eurostar",
      ref: "AB1234",
      date: "2026-09-18",
      departs: { station: "London St Pancras Int'l", time: "16:31" },
      arrives: { station: "Paris Gare du Nord", time: "19:49" },
      duration_min: 138,
      class: "Standard",
      seats: [
        { traveller: "Judy Jetson", coach: 5, seat: 84 },
        { traveller: "George Jetson", coach: 5, seat: 83 }
      ],
      cost: {
        total: 156.00,
        currency: "GBP",
        status: "paid",
        paid_by: "Judy Jetson"
      }
    },
    {
      id: "seg-2",
      type: "accommodation",
      name: "Cosy Studio near Sacré-Cœur",
      host: "Pierre",
      ref: "XY9876Z",
      address: "42 Rue de Rivoli, 75001 Paris, France",
      lat: 48.8566,
      lng: 2.3522,
      checkin: { date: "2026-09-18", from: "13:00" },
      checkout: { date: "2026-09-19", by: "13:00" },
      guests: 2,
      nights: 1,
      self_checkin: true,
      cost: {
        amount: 87.24,
        currency: "GBP",
        status: "paid",
        paid_by: "Judy Jetson"
      },
      notes: "Smart checkin",
      date: "2026-09-18"
    }
  ]
};

test.describe('Holiday Itinerary Viewer', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to the local server hosting the itinerary viewer page
    await page.goto('/holiday_itinerary_viewer.html');
  });

  test('should load the page with the upload screen visible and app hidden', async ({ page }) => {
    // Check page title / header
    await expect(page.locator('h2.sr-only')).toHaveText('Holiday itinerary viewer — upload a HolidayItinerary JSON to explore timeline, budget and map views');
    
    // Check upload view elements are visible
    const uploadDiv = page.locator('#hupl');
    await expect(uploadDiv).toBeVisible();
    await expect(page.locator('div:text-is("Itinerary viewer")')).toBeVisible();
    await expect(page.locator('#hdz')).toBeVisible();
    
    // Check app view is hidden
    await expect(page.locator('#happ')).toBeHidden();
  });

  test('should load a generic itinerary when uploading a valid JSON file', async ({ page }) => {
    // Upload genericItinerary
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });

    // Upload screen should be hidden, app screen visible
    await expect(page.locator('#hupl')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();

    // Verify trip name and travellers meta
    await expect(page.locator('#htname')).toHaveText('Summer Rail Tour 2026');
    await expect(page.locator('#htmeta')).toContainText('Judy Jetson & George Jetson');

    // Verify Timeline contains correct segments
    const timeline = page.locator('#hvlist');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.hseg')).toHaveCount(2);
  });

  test('should allow switching tabs and update views accordingly', async ({ page }) => {
    // Upload genericItinerary
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });

    // Initially "Timeline" tab is active, others inactive
    await expect(page.locator('.htab[data-v="list"]')).toHaveClass(/on/);
    await expect(page.locator('.htab[data-v="budget"]')).not.toHaveClass(/on/);
    await expect(page.locator('.htab[data-v="map"]')).not.toHaveClass(/on/);

    await expect(page.locator('#hvlist')).toBeVisible();
    await expect(page.locator('#hvbudget')).toBeHidden();
    await expect(page.locator('#hvmap')).toBeHidden();

    // Click "Budget" tab
    await page.click('.htab[data-v="budget"]');
    await expect(page.locator('.htab[data-v="budget"]')).toHaveClass(/on/);
    await expect(page.locator('.htab[data-v="list"]')).not.toHaveClass(/on/);
    
    await expect(page.locator('#hvlist')).toBeHidden();
    await expect(page.locator('#hvbudget')).toBeVisible();

    // Click "Map" tab
    await page.click('.htab[data-v="map"]');
    await expect(page.locator('.htab[data-v="map"]')).toHaveClass(/on/);
    await expect(page.locator('.htab[data-v="budget"]')).not.toHaveClass(/on/);

    await expect(page.locator('#hvbudget')).toBeHidden();
    await expect(page.locator('#hvmap')).toBeVisible();
  });

  test('should calculate and display the correct budget figures on the Budget tab', async ({ page }) => {
    // Upload genericItinerary
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });
    await page.click('.htab[data-v="budget"]');

    // Check key budget summary elements
    const paidCard = page.locator('.hsmc:has-text("Paid")');
    await expect(paidCard).toBeVisible();
    await expect(paidCard).toContainText('£243.24');
    
    const pendingCard = page.locator('.hsmc:has-text("Pending")');
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard).toContainText('£0.00');

    const totalCard = page.locator('.hsmc:has-text("Total confirmed")');
    await expect(totalCard).toBeVisible();
    await expect(totalCard).toContainText('£243.24');
  });

  test('should render gantt blocks and support compact toggle', async ({ page }) => {
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });
    await page.click('.htab[data-v="gantt"]');
    await expect(page.locator('#hvgantt')).toBeVisible();

    // Blocks should be present in each lane
    const blocks = page.locator('#hvgantt .hgt-blk');
    await expect(blocks).toHaveCount(2); // 1 transport + 1 accommodation

    // Toggle button present, labelled "Compact" in proportional mode
    const toggleBtn = page.locator('#hvgantt button');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toContainText('Compact');

    // Record proportional body height
    const bodyProp = page.locator('#hvgantt .hgt-body');
    const propHeight = await bodyProp.evaluate(el => el.offsetHeight);

    // Switch to compact mode
    await toggleBtn.click();
    await expect(toggleBtn).toContainText('Time');

    // Compact body must be shorter than proportional
    const compactHeight = await bodyProp.evaluate(el => el.offsetHeight);
    expect(compactHeight).toBeLessThan(propHeight);

    // Blocks still present and in topological order within each lane
    const lanes = page.locator('#hvgantt .hgt-col');
    for (let i = 0; i < await lanes.count(); i++) {
      const tops = await lanes.nth(i).locator('.hgt-blk').evaluateAll(
        els => els.map(e => parseFloat(e.style.top)).filter(t => !isNaN(t))
      );
      for (let j = 1; j < tops.length; j++) {
        expect(tops[j]).toBeGreaterThanOrEqual(tops[j - 1]);
      }
    }

    // Toggle back to proportional
    await toggleBtn.click();
    await expect(toggleBtn).toContainText('Compact');
    const restoredHeight = await bodyProp.evaluate(el => el.offsetHeight);
    expect(restoredHeight).toBe(propHeight);
  });

  test('should sort accommodation after transport on the same day even when check-in opens earlier', async ({ page }) => {
    // genericItinerary has: accommodation check-in from 13:00 and Eurostar departing 16:31, both on 2026-09-18.
    // The accommodation must sort last (after transport) regardless of its check-in window time.
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });

    const segs = page.locator('#hvlist .hseg');
    await expect(segs).toHaveCount(2);
    await expect(segs.nth(0)).toContainText('Eurostar');
    await expect(segs.nth(1)).toContainText('Cosy Studio near Sacré-Cœur');
  });

  test('should render timeline blocks at accurate heights with text in a popover', async ({ page }) => {
    // A 15-minute event would previously be inflated to the old 28px minimum,
    // pushing its end position past the true time. It should now render short.
    const shortEventItinerary = {
      trip: {
        name: "Short Event Trip",
        travellers: ["Alice"],
        start: "2026-08-01",
        end: "2026-08-02",
        currency_primary: "GBP"
      },
      segments: [
        {
          id: "evt-short",
          type: "event",
          name: "Quick Coffee",
          subtype: "other",
          date: "2026-08-01",
          time: "10:00",
          duration_min: 15,
          cost: { amount: 5, currency: "GBP", status: "paid", paid_by: "Alice" }
        },
        {
          id: "evt-long",
          type: "event",
          name: "Museum Afternoon",
          subtype: "tour",
          date: "2026-08-01",
          time: "13:00",
          duration_min: 240,
          cost: { amount: 30, currency: "GBP", status: "paid", paid_by: "Alice" }
        }
      ]
    };

    await page.setInputFiles('#hfile', {
      name: 'short_event.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(shortEventItinerary))
    });
    await page.click('.htab[data-v="gantt"]');

    const blocks = page.locator('#hvgantt .hgt-blk');
    await expect(blocks).toHaveCount(2);
    const shortBlk = blocks.first(); // Quick Coffee (renders first / earlier)
    const longBlk = blocks.last();   // Museum Afternoon

    // Accurate height: a 15-min block must be far shorter than the old 28px floor.
    const h = await shortBlk.evaluate(el => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(20);

    // Too short to fit a label — text is not baked in, only the popover carries it.
    await expect(shortBlk).toHaveText('');

    // A block with room shows its label inline for glanceability.
    await expect(longBlk).toContainText('Museum Afternoon');

    // Hovering the short block still reveals its full detail via the popover.
    await shortBlk.hover();
    const pop = page.locator('.hgt-pop');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('Quick Coffee');
    await expect(pop).toContainText('10:00');
  });

  test('should successfully load a custom uploaded JSON itinerary', async ({ page }) => {
    const customItinerary = {
      trip: {
        name: "Test Weekend Getaway",
        travellers: ["Alice", "Bob"],
        start: "2026-09-04",
        end: "2026-09-06",
        currency_primary: "EUR"
      },
      segments: [
        {
          id: "seg-custom-1",
          type: "accommodation",
          name: "Cozy Cabin in the Woods",
          host: "Host Dave",
          ref: "CABIN123",
          address: "123 Forest Path",
          lat: 45.0,
          lng: 5.0,
          checkin: { date: "2026-09-04", from: "14:00" },
          checkout: { date: "2026-09-06", by: "11:00" },
          guests: 2,
          nights: 2,
          self_checkin: false,
          cost: {
            amount: 150.0,
            currency: "EUR",
            status: "paid",
            paid_by: "Alice"
          },
          date: "2026-09-04"
        }
      ]
    };

    // Use page.setInputFiles to upload the JSON directly to the hidden input
    await page.setInputFiles('#hfile', {
      name: 'custom_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(customItinerary))
    });

    // Check that uploader is hidden, and app is visible
    await expect(page.locator('#hupl')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();

    // Verify metadata for the custom trip
    await expect(page.locator('#htname')).toHaveText('Test Weekend Getaway');
    await expect(page.locator('#htmeta')).toContainText('Alice & Bob');

    // Verify segment is shown in the timeline
    await expect(page.locator('#hvlist')).toContainText('Cozy Cabin in the Woods');
    await expect(page.locator('#hvlist')).toContainText('Host Dave');
  });

  test('should show a sticky date strip that jumps to a day (issue #21)', async ({ page }) => {
    // A multi-day itinerary with enough cards that later days start off-screen.
    const days = ['2026-08-01', '2026-08-02', '2026-08-03'];
    const segments = days.flatMap((date, di) => [0, 1, 2, 3, 4, 5].map(i => ({
      id: `evt-${di}-${i}`,
      type: 'event',
      name: `Activity ${di + 1}.${i + 1}`,
      subtype: 'activity',
      date,
      time: `${String(8 + i * 2).padStart(2, '0')}:00`,
      duration_min: 60,
      notes: 'A note to give each card a little more height for scrolling.',
      cost: { amount: 10, currency: 'GBP', status: 'paid', paid_by: 'Alice' }
    })));
    const multiDay = {
      trip: { name: 'Strip Test', travellers: ['Alice'], start: '2026-08-01', end: '2026-08-03', currency_primary: 'GBP' },
      segments
    };
    await page.setInputFiles('#hfile', {
      name: 'multi_day.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(multiDay))
    });

    // One chip per day, labelled with weekday + day of month.
    const chips = page.locator('#hvlist .hday-chip');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveText('Sat 1');
    await expect(chips.nth(2)).toHaveText('Mon 3');

    // Clicking the last chip smooth-scrolls that day's section up under the
    // strip, so poll until the scroll animation lands it there.
    await chips.nth(2).click();
    await expect.poll(() => page.locator('#hvlist .hday[data-d="2026-08-03"]')
      .evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(120);
    expect(await page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(200);

    // The scroll-spy marks the jumped-to day's chip as active.
    await expect(chips.nth(2)).toHaveClass(/on/);
  });

  test('should link from a gantt block popover to the timeline (issue #21)', async ({ page }) => {
    await page.setInputFiles('#hfile', {
      name: 'generic_itinerary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(genericItinerary))
    });

    // Single-day itineraries get no date strip.
    await expect(page.locator('#hvlist .hday-nav')).toHaveCount(0);

    await page.click('.htab[data-v="gantt"]');
    const blk = page.locator('#hvgantt .hgt-blk').first(); // accommodation lane
    await blk.hover();
    const pop = page.locator('.hgt-pop');
    await expect(pop).toBeVisible();
    const link = pop.locator('.hgt-pop-link');
    await expect(link).toContainText('Open in timeline');

    await link.click();
    // Back on the timeline with the segment's card flashed for orientation.
    await expect(page.locator('.htab[data-v="list"]')).toHaveClass(/on/);
    await expect(page.locator('#hvlist')).toBeVisible();
    await expect(pop).toBeHidden();
    await expect(page.locator('#hvlist .hseg.hl')).toContainText('Cosy Studio near Sacré-Cœur');
  });

  test('should surface "now" during the trip: Today chip, auto-jump, gantt line (issue #35)', async ({ page }) => {
    // Freeze the clock mid-trip, then reload so every render sees the fake time.
    await page.clock.setFixedTime(new Date('2026-08-02T14:30:00'));
    await page.goto('/holiday_itinerary_viewer.html');

    const days = ['2026-08-01', '2026-08-02', '2026-08-03'];
    const segments = days.flatMap((date, di) => [0, 1, 2, 3, 4, 5].map(i => ({
      id: `evt-${di}-${i}`,
      type: 'event',
      name: `Activity ${di + 1}.${i + 1}`,
      subtype: 'activity',
      date,
      time: `${String(8 + i * 2).padStart(2, '0')}:00`,
      duration_min: 60,
      cost: { amount: 10, currency: 'GBP', status: 'paid', paid_by: 'Alice' }
    })));
    await page.setInputFiles('#hfile', {
      name: 'mid_trip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        trip: { name: 'Now Test', travellers: ['Alice'], start: '2026-08-01', end: '2026-08-03', currency_primary: 'GBP' },
        segments
      }))
    });

    // The date strip gets a Today shortcut targeting the current day, and
    // today's own chip is marked.
    const todayBtn = page.locator('#hvlist .hday-chip.hday-today');
    await expect(todayBtn).toContainText('Today');
    await expect(todayBtn).toHaveAttribute('data-d', '2026-08-02');
    await expect(page.locator('#hvlist .hday-chip.is-today')).toHaveText('Sun 2');

    // The timeline opened at the current day rather than the top of the trip.
    await expect.poll(() => page.locator('#hvlist .hday[data-d="2026-08-02"]')
      .evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(120);

    // The gantt shows a current-time line at 14:30 on day 2 of the
    // proportional scale, with the time labelled in the axis.
    await page.click('.htab[data-v="gantt"]');
    const nowLine = page.locator('#hvgantt .hgt-now');
    await expect(nowLine).toBeVisible();
    const top = await nowLine.evaluate(el => parseFloat(el.style.top));
    expect(top).toBeCloseTo((24 + 14.5) * 60 * 0.25, 0); // PX_PER_MIN = 0.25
    await expect(page.locator('#hvgantt .hgt-now-lbl')).toHaveText('14:30');

    // The line survives (and stays correct in) compact mode.
    await page.locator('#hvgantt button').first().click();
    await expect(nowLine).toBeVisible();
  });

  test('should hide the now markers when the trip is not underway (issue #35)', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-01T12:00:00'));
    await page.goto('/holiday_itinerary_viewer.html');

    const futureTrip = {
      trip: { name: 'Future Trip', travellers: ['Alice'], start: '2026-08-01', end: '2026-08-03', currency_primary: 'GBP' },
      segments: ['2026-08-01', '2026-08-02'].map((date, i) => ({
        id: `evt-${i}`, type: 'event', name: `Thing ${i}`, subtype: 'activity',
        date, time: '10:00', duration_min: 60,
        cost: { amount: 10, currency: 'GBP', status: 'paid', paid_by: 'Alice' }
      }))
    };
    await page.setInputFiles('#hfile', {
      name: 'future_trip.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(futureTrip))
    });

    await expect(page.locator('#hvlist .hday-chip')).toHaveCount(2);
    await expect(page.locator('#hvlist .hday-chip.hday-today')).toHaveCount(0);
    await expect(page.locator('#hvlist .hday-chip.is-today')).toHaveCount(0);

    await page.click('.htab[data-v="gantt"]');
    await expect(page.locator('#hvgantt .hgt-now')).toBeHidden();
    await expect(page.locator('#hvgantt .hgt-now-lbl')).toBeHidden();
  });

  test('should keep the chat input footer within the visual viewport on mobile (issue #25)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    // A stored key makes chatOpen focus the input instead of popping settings.
    await page.evaluate(() => localStorage.setItem('hOpenRouterKey', 'test-key'));
    await page.reload();

    await page.evaluate(() => globalThis.hChatOpen());
    await expect(page.locator('#hchat')).toBeVisible();

    // The panel is pinned to the visual viewport, so its footer (the input box)
    // must sit inside the visible area rather than off the bottom of the page.
    const m = await page.evaluate(() => {
      const el = globalThis.document.getElementById('hchat');
      const ft = globalThis.document.getElementById('hchat-ft');
      return {
        panelHeight: el.style.height,
        vvHeight: globalThis.visualViewport.height + 'px',
        footerBottom: ft.getBoundingClientRect().bottom,
        winH: globalThis.innerHeight,
      };
    });
    expect(m.panelHeight).toBe(m.vvHeight);
    expect(m.footerBottom).toBeLessThanOrEqual(m.winH + 0.5);

    // The input font must be >= 16px or iOS Safari auto-zooms to it on focus.
    const inputFont = await page.evaluate(() => parseFloat(
      globalThis.getComputedStyle(globalThis.document.getElementById('hchat-input')).fontSize));
    expect(inputFont).toBeGreaterThanOrEqual(16);

    // On small screens the open panel is fullscreen and the page behind it is
    // out of play (issue #48): body scroll locked, background hidden, panel
    // spanning the viewport — so there is nothing behind the panel to scroll.
    const open = await page.evaluate(() => {
      const doc = globalThis.document;
      return {
        bodyClass: doc.body.classList.contains('hchat-open'),
        bodyOverflow: globalThis.getComputedStyle(doc.body).overflow,
        uplVisibility: globalThis.getComputedStyle(doc.getElementById('hupl')).visibility,
        panelWidth: doc.getElementById('hchat').getBoundingClientRect().width,
        msgsOverscroll: globalThis.getComputedStyle(doc.getElementById('hchat-msgs')).overscrollBehaviorY,
      };
    });
    expect(open.bodyClass).toBe(true);
    expect(open.bodyOverflow).toBe('hidden');
    expect(open.uplVisibility).toBe('hidden');
    expect(open.panelWidth).toBe(390); // full viewport width
    expect(open.msgsOverscroll).toBe('contain');

    // Closing releases the body lock and the inline sizing back to CSS rules.
    await page.evaluate(() => globalThis.hChatClose());
    const closed = await page.evaluate(() => {
      const doc = globalThis.document;
      return {
        bodyClass: doc.body.classList.contains('hchat-open'),
        uplVisibility: globalThis.getComputedStyle(doc.getElementById('hupl')).visibility,
        height: doc.getElementById('hchat').style.height,
      };
    });
    expect(closed.bodyClass).toBe(false);
    expect(closed.uplVisibility).toBe('visible');
    expect(closed.height).toBe('');
  });
});
