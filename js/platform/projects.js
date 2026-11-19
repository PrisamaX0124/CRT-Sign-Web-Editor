(function (global) {
  'use strict';

  const State = global.PlatformState;
  global.PlatformProjects = global.SignProjects.createLibrary({
    databaseName: 'public-platform-projects',
    legacyKey: 'public-platform-sign-project-v1',
    legacyName: '原有站台项目',
    createDefault: State.create,
    serialize: State.serialize,
    deserialize: State.deserialize,
    describe: state => ({ lineName: state.lineName || state.line, color: state.color, stationCount: state.stations.length }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
