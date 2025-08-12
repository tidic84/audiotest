import TextField from '@mui/material/TextField';
import FastRewindIcon from '@mui/icons-material/FastRewind';
import FastForwardIcon from '@mui/icons-material/FastForward';
import ArrowRight from '@mui/icons-material/ArrowRight';
import ArrowLeft from '@mui/icons-material/ArrowLeft';
import { Box, IconButton } from "@mui/material";
 
import { ButtonGroup } from '@mui/material';

function OBSNavigator({max, setObs, obs}) {

    const StyledNumberInput = {
        root: {
            style: {
                display: 'inline-flex',
                alignItems: 'center',
            }
        },
        input: {
            style: {
                width: '4rem',
                height: '2rem',
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
                <TextField
                    min={1}
                    max={50}
                    value={obs[0]}
                    type="number"
                    onChange={(event) => {
                        const raw = parseInt(event.target.value, 10);
                        const safe = Number.isNaN(raw) ? 1 : raw;
                        const clamped = Math.max(1, Math.min(50, safe));
                        setObs([clamped, 0]);
                    }}
                    inputProps={{ min: 1, max: 50, inputMode: 'numeric', pattern: '[0-9]*' }}
                    slotProps={StyledNumberInput}
                />
                :
                <TextField
                    min={0}
                    max={max}
                    value={obs[1]}
                    type="number"
                    onChange={(event) => {
                        const raw = parseInt(event.target.value, 10);
                        const safe = Number.isNaN(raw) ? 0 : raw;
                        const clamped = Math.max(0, Math.min(max ?? 0, safe));
                        setObs([obs[0], clamped]);
                    }}
                    inputProps={{ min: 0, max: max, inputMode: 'numeric', pattern: '[0-9]*' }}
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