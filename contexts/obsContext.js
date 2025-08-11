import {createContext} from 'react';

const OBSContext = createContext({obs: [1,0], setObs: ()=> {}});

export default OBSContext;