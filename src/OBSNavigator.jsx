import { Unstable_NumberInput as NumberInput } from '@mui/base/Unstable_NumberInput';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import FastForwardIcon from '@mui/icons-material/FastForward';
import ArrowRight from '@mui/icons-material/ArrowRight';
import ArrowLeft from '@mui/icons-material/ArrowLeft';
import { Box, IconButton } from "@mui/material";
import { useContext } from "react";
import OBSContext from "../contexts/obsContext";
import { ButtonGroup } from '@mui/material';

function OBSNavigator({max}) {

    const { obs, setObs } = useContext(OBSContext);

    const StyledNumberInput = {
        root: {
            style: {
                display: 'inline-flex',
                alignItems: 'center',
            }
        },
        input: {
            style: {
                width: '1.5rem',
                height: '1rem',
                textAlign: 'center',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                outline: 'none',
                '&:focus': {
                    borderColor: '#1976d2',
                    boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.2)',
                }
            }
        }
    }
    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <ButtonGroup>
                <IconButton disabled={obs[0] <= 1} onClick={() => setObs([obs[0] - 1 > 0 ? obs[0] - 1 : obs[0], 0])}>
                    <FastRewindIcon fontSize="large" />
                </IconButton>
                <IconButton disabled={obs[1] <= 0} onClick={() => setObs([obs[0], obs[1] - 1 >= 0 ? obs[1] - 1 : obs[1]])}>
                    <ArrowLeft fontSize="large" />
                </IconButton>
            </ButtonGroup>

            <Box sx={{
                border: '1px solid #DAE2ED',
                borderRadius: '8px',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                display: 'flex',
                backgroundColor: '#fafafa',
                paddingX: '1rem',
                paddingY: '0.3rem',
            }}>                
                <NumberInput
                    min={1}
                    max={50}
                    value={obs[0]}
                    onChange={(event, val) => {
                        setObs([val, obs[1]]);
                    }}
                    slotProps={StyledNumberInput}
                />
                :
                <NumberInput
                    min={0}
                    max={max}
                    value={obs[1]}
                    onChange={(event, val) => {
                        setObs([obs[0], val]);
                    }}
                    slotProps={StyledNumberInput}
                />
            </Box>

            <ButtonGroup>
                <IconButton disabled={obs[1] >= max} onClick={() => setObs([obs[0], obs[1] + 1 <= max ? obs[1] + 1 : obs[1]])}>
                    <ArrowRight fontSize="large" />
                </IconButton>
                <IconButton disabled={obs[0] >= 50} onClick={() => setObs([obs[0] + 1 <= 50 ? obs[0] + 1 : obs[0], 0])}>
                    <FastForwardIcon fontSize="large" />
                </IconButton>
            </ButtonGroup>
        </Box>
    )
}

export default OBSNavigator;