.PHONY: format format-check

format:
	npx --yes prettier --write ./src

format-check:
	npx --yes prettier --check ./src
