# 템플릿 업데이트

[← README로 돌아가기](../../README_KO.md)

```bash
cd /path/to/cc-baseline

# templates/ 하위 파일 편집
# $HOME 대신 {{HOME}} 플레이스홀더 사용

# 커밋 전 민감 정보 스캔
grep -rE "$(whoami)|/Users/|/home/" templates/

git add templates/ && git commit -m "feat: update harness templates"
git push
```
