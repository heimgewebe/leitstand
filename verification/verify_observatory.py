
from playwright.sync_api import sync_playwright

def verify_observatory_plexer_panel():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Leitstand server default port is 3000
            page.goto("http://localhost:3000/observatory")

            # Wait for content to load
            page.wait_for_selector("h1")

            # Check for "Plexer Delivery Status" section
            # This should exist even if empty/missing (it renders "No delivery metrics available")
            if page.get_by_text("Plexer Delivery Status").count() > 0:
                print("Found Plexer Delivery Status section")
            else:
                print("ERROR: Plexer Delivery Status section not found")

            # Take screenshot
            page.screenshot(path="verification/observatory_plexer.png", full_page=True)
            print("Screenshot saved to verification/observatory_plexer.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_observatory_plexer_panel()
