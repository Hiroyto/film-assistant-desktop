# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 12-screens-modernized-contract-parity.spec.ts >> @paridade-comportamental telas modernizadas (4) >> @paridade-comportamental Restart Now → restarting + installUpdate
- Location: parity\specs\12-screens-modernized-contract-parity.spec.ts:60:7

# Error details

```
Error: page.evaluate: TypeError: Efe(...).emitUpdate is not a function
    at Proxy.emitUpdate (http://localhost:3100/static/js/main.92505e0c.js:2:3349415)
    at eval (eval at evaluate (:302:30), <anonymous>:3:196)
    at UtilityScript.evaluate (<anonymous>:304:16)
    at UtilityScript.<anonymous> (<anonymous>:1:44)
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - status [ref=e9]: error
    - banner [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]:
          - img "Logo" [ref=e15] [cursor=pointer]
          - navigation [ref=e16]:
            - link "App" [ref=e17] [cursor=pointer]:
              - /url: "#/dashboard"
            - link "Profile":
              - /url: "#/profile"
            - link "Pricing":
              - /url: "#/prices"
            - img [ref=e19]
        - generic [ref=e21]:
          - button "filmassistant.io filmassistant.io ▼" [ref=e23] [cursor=pointer]:
            - img "filmassistant.io" [ref=e25]
            - generic: filmassistant.io
            - generic [ref=e26]: ▼
          - generic [ref=e28]:
            - generic [ref=e29]:
              - img [ref=e30]
              - generic [ref=e32]: "0"
            - generic [ref=e33]: Tokens Remaining
          - button [ref=e34]:
            - img [ref=e35]
    - generic [ref=e38]:
      - generic [ref=e39]:
        - generic [ref=e40]:
          - heading "Every Great Story Starts with a Single Spark" [level=1] [ref=e41]:
            - text: Every Great Story Starts
            - text: with a Single Spark
          - paragraph [ref=e42]: Turn a spark into your next project.
          - textbox "Let your creativity flow freely..." [ref=e44]: A
          - generic [ref=e45]:
            - button "Build Your Story" [ref=e46] [cursor=pointer]:
              - generic [ref=e47]: Build Your Story
            - generic [ref=e49]: or
            - button "Blank Outline" [ref=e50] [cursor=pointer]
        - button "View Your Stories" [ref=e51] [cursor=pointer]:
          - generic [ref=e52]: View Your Stories
          - img [ref=e53]
      - heading "Continue Building 0 / 5" [level=2] [ref=e57]:
        - text: Continue Building
        - generic [ref=e58]:
          - img [ref=e59]
          - text: 0 / 5
      - contentinfo [ref=e80]:
        - generic [ref=e83]:
          - paragraph [ref=e84]: © 2026 FilmAssistant Inc. All rights reserved.
          - generic [ref=e85]:
            - img [ref=e86]
            - link "accountservices@filmassistant.io" [ref=e88] [cursor=pointer]:
              - /url: mailto:accountservices@filmassistant.io
          - link "Terms of Service" [ref=e89] [cursor=pointer]:
            - /url: https://app.getterms.io/view/RRt2r/tos/en-us
  - status "All changes saved locally and synced to cloud." [ref=e91]:
    - img [ref=e92]
    - generic [ref=e95]: Synced
```