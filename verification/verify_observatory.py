import sys
from playwright.sync_api import sync_playwright

def verify_observatory():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to observatory...")
            page.goto("http://localhost:3000/observatory")
            print("Page loaded. Taking screenshot...")
            page.screenshot(path="verification/observatory_integrity.png", full_page=True)
            print("Screenshot saved to verification/observatory_integrity.png")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    verify_observatory()
