# Toolcraft control port

This folder adapts selected controls from
[`pixel-point/toolcraft`](https://github.com/pixel-point/toolcraft) at commit
`682a159f985af71798296f15c1cd6434b5fe7151`, retrieved on 2026-07-25.

Adapted surfaces:

- slider and range-slider value policy and controls;
- color input;
- segmented input;
- select input;
- file drop target;
- live history grouping types.

SpriteBoy keeps the public ideas and behavior that fit the Studio, but uses
native browser controls, existing React/Lucide packages and local design
tokens. It does not copy Toolcraft's starter, shell, navigation, global styles,
drag-and-drop stack or Base UI dependency.

## Upstream notice

Toolcraft was generated with Toolcraft and includes Toolcraft runtime, starter,
UI component, documentation and template source code. The upstream repository
uses the MIT License.

## MIT License

Copyright (c) 2026 Pixel Point

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
