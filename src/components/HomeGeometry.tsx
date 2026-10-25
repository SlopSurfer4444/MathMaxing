import './home-geometry.css'

/** Brand illustration. It deliberately contains no data or hints for the current task. */
export function HomeGeometry() {
  return <div className="home-geometry" aria-hidden="true">
    <svg viewBox="0 0 320 280" fill="none" focusable="false">
      <path className="home-geometry-plane" d="m35 7 245-35 88 243-244 35Z"/>
      <path className="home-geometry-core" d="m-8 103 326-49 19 58-326 49Z"/>
      <path className="home-geometry-cut" d="m-5 170 130-20 42 126-130 20Z"/>
      <path className="home-geometry-line" d="m35 7 67 194M-8 103l326-49M11 161l326-49M160 217l145-22M118 182l42 126"/>
      <path className="home-geometry-lens" d="m271 59 31-4 23 62-32 5Z"/>
    </svg>
  </div>
}
