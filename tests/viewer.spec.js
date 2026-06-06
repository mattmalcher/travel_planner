import { test, expect } from '@playwright/test';

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

  test('should load the example trip when clicking the example button', async ({ page }) => {
    // Click on "Load example trip"
    await page.click('button:has-text("Load example trip")');

    // Upload screen should be hidden, app screen visible
    await expect(page.locator('#hupl')).toBeHidden();
    await expect(page.locator('#happ')).toBeVisible();

    // Verify trip name and travellers meta
    await expect(page.locator('#htname')).toHaveText('Paris, Bayonne & Luz-Saint-Sauveur 2026');
    await expect(page.locator('#htmeta')).toContainText('Judy Jetson & George Jetson');

    // Verify Timeline contains some segments
    const timeline = page.locator('#hvlist');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.hseg')).not.toHaveCount(0);
  });

  test('should allow switching tabs and update views accordingly', async ({ page }) => {
    await page.click('button:has-text("Load example trip")');

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
    await page.click('button:has-text("Load example trip")');
    await page.click('.htab[data-v="budget"]');

    // Check key budget summary elements
    const paidCard = page.locator('.hsmc:has-text("Paid")');
    await expect(paidCard).toBeVisible();
    
    const pendingCard = page.locator('.hsmc:has-text("Pending")');
    await expect(pendingCard).toBeVisible();

    const totalCard = page.locator('.hsmc:has-text("Total confirmed")');
    await expect(totalCard).toBeVisible();
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
