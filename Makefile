.PHONY: help install build host lint validate itin test test-unit test-e2e test-ui

# Which itinerary file(s) `make validate` checks. Unquoted on purpose: the
# recipe's shell expands the glob.
FILE ?= data/*.json

help: ## Show this help message
	@echo "Available commands:"
	@echo "  make install    - Install node dependencies"
	@echo "  make build      - Build dist/holiday_itinerary_viewer.html from src/"
	@echo "  make host       - Build and host the viewer locally"
	@echo "  make lint       - Run ESLint over src/, scripts/ and tests/"
	@echo "  make validate   - Schema-check and lint itinerary JSON (FILE=data/*.json)"
	@echo "  make itin       - Run an itinerary CLI subcommand (ARGS=\"digest data/x.json\")"
	@echo "  make test       - Run unit tests then headless Playwright E2E tests"
	@echo "  make test-unit  - Run only the fast unit tests (node --test)"
	@echo "  make test-e2e   - Build, then run only the Playwright E2E tests"
	@echo "  make test-ui    - Open Playwright interactive test UI"

install: ## Install package dependencies
	npm install

build: ## Build the standalone viewer into dist/
	npm run build

host: ## Build and host the application locally on http://localhost:8345
	npm run host

lint: ## Run ESLint
	npm run lint

validate: ## Schema-check and lint an itinerary JSON file (FILE=data/*.json)
	npm run validate -- $(FILE)

itin: ## Run an itinerary CLI subcommand (ARGS="digest data/trip.json")
	npm run itin -- $(ARGS)

test: ## Run unit tests then Playwright E2E tests headlessly
	npm run test

test-unit: ## Run unit tests only (milliseconds)
	npm run test:unit

test-e2e: ## Build and run Playwright E2E tests only
	npm run test:e2e

test-ui: ## Run Playwright tests in interactive UI mode
	npm run test:ui
