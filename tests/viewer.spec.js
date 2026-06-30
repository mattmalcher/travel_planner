import { test, expect } from '@playwright/test';

const genericItinerary = {
  trip: {
    name: "Paris, Bayonne & Luz-Saint-Sauveur 2026",
    travellers: ["Judy Jetson", "George Jetson"],
    start: "2026-07-03",
    end: "2026-07-13",
    currency_primary: "GBP"
  },
  segments: [
    {
      id: "seg-1",
      type: "transport",
      mode: "train",
      operator: "Eurostar",
      ref: "AB1234",
      date: "2026-07-03",
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
      checkin: { date: "2026-07-03", from: "13:00" },
      checkout: { date: "2026-07-04", by: "13:00" },
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
      date: "2026-07-03"
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
    await expect(page.locator('#htname')).toHaveText('Paris, Bayonne & Luz-Saint-Sauveur 2026');
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
    // genericItinerary has: accommodation check-in from 13:00 and Eurostar departing 16:31, both on 2026-07-03.
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
        }
      ]
    };

    await page.setInputFiles('#hfile', {
      name: 'short_event.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(shortEventItinerary))
    });
    await page.click('.htab[data-v="gantt"]');

    const blk = page.locator('#hvgantt .hgt-blk');
    await expect(blk).toHaveCount(1);

    // Accurate height: a 15-min block must be far shorter than the old 28px floor.
    const h = await blk.evaluate(el => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(20);

    // Text is no longer baked into the block.
    await expect(blk).toHaveText('');

    // Hovering reveals the label and times via the popover.
    await blk.hover();
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
});
