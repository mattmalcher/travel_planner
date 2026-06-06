.PHONY: help install host test test-ui

help: ## Show this help message
	@echo "Available commands:"
	@echo "  make install   - Install node dependencies"
	@echo "  make host      - Host the itinerary viewer app locally"
	@echo "  make test      - Run headless Playwright E2E tests"
	@echo "  make test-ui   - Open Playwright interactive test UI"

install: ## Install package dependencies
	npm install

host: ## Host the application locally on http://localhost:8345
	npm run host

test: ## Run Playwright tests headlessly
	npm run test

test-ui: ## Run Playwright tests in interactive UI mode
	npm run test:ui
