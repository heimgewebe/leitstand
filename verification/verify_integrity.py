from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000/observatory")

        # Wait for the Integrity section to appear
        page.wait_for_selector("h2:has-text('System Integrity')")

        # Take a screenshot of the whole page, or just the integrity table
        page.screenshot(path="verification/integrity_view.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    run()
