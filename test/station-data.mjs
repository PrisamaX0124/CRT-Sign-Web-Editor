export function createStationProject(state) {
  const lines = [
    '01|松林站|Pine Grove|1',
    '02|河西站|West River|5,6',
    '03|花园站|Garden Avenue|2',
    '04|沿江站|Riverside|4',
    '05|中央站|Central Station|1',
    '06|湖边站|Lakeside|9',
    '07|北广场站|North Square',
    '08|客运站|Coach Station',
  ];
  const stations = state.parseStations(lines.join('\n'), 'chongqing');
  return state.settings(state.replaceStations(state.create(), stations), {
    currentId: stations[4].id,
    line: '10',
    lineName: '10号线',
  });
}

export function createVerticalProject(state) {
  const lines = [
    '01|松林站|Pine Grove|9',
    '02|河西站|West River',
    '03|花园站|Garden Avenue|3',
    '04|沿江站|Riverside|5,6',
    '05|中央站|Central Station',
    '06|湖边站|Lakeside|2',
    '07|北广场站|North Square|4',
    '08|客运站|Coach Station|1',
    '09|大桥站|Grand Bridge|9',
    '10|东广场站|East Square',
    '11|港口站|Harbor Station',
  ];
  const stations = state.parseStations(lines.join('\n'), 'chongqing');
  return state.settings(state.replaceStations(state.create(), stations), {
    mode: 'vertical',
    direction: 1,
    currentId: stations[6].id,
  });
}
