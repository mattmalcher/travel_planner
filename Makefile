.PHONY: help install build host demo lint validate itin test test-unit test-e2e test-ui

# Which itinerary file(s) `make validate` checks. Unquoted on purpose: the
# recipe's shell expands the glob.
FILE ?= data/*.json

# Built from the `##` comments on each target below, so a target and its
# description cannot drift apart — they used to be written twice, once as a
# comment nothing parsed and once as a hard-coded echo here.
help: ## Show this help message
	@echo "Available commands:"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-10s - %s\n", $$1, $$2}'

install: ## Install node dependencies
	npm install

build: ## Build dist/holiday_itinerary_viewer.html from src/
	npm run build

host: ## Build and host the viewer on http://localhost:8345
	npm run host

demo: ## Build, then record demo/demo.gif (needs ffmpeg)
	npm run demo

lint: ## Run ESLint over src/, scripts/, worker/ and tests/
	npm run lint

validate: ## Schema-check and lint itinerary JSON (FILE=data/*.json)
	npm run validate -- $(FILE)

itin: ## Run an itinerary CLI subcommand (ARGS="digest data/trip.json")
	npm run itin -- $(ARGS)

test: ## Run unit tests then headless Playwright E2E tests
	npm run test

test-unit: ## Run only the fast unit tests (node --test)
	npm run test:unit

test-e2e: ## Build, then run only the Playwright E2E tests
	npm run test:e2e

test-ui: ## Open Playwright interactive test UI
	npm run test:ui
