# Updating Templates

[← Back to README](../README.md)

```bash
cd /path/to/cc-baseline

# Edit files under templates/
# Use {{HOME}} as a placeholder for $HOME

# Scan for sensitive data before committing
grep -rE "$(whoami)|/Users/|/home/" templates/

git add templates/ && git commit -m "feat: update harness templates"
git push
```
